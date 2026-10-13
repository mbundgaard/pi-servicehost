"""Disposable Linux PTY + authenticated protocol fixture; never launches services."""
import fcntl
import http.server
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time

cli = os.path.abspath('dist/cli.js')
operations = []
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        with open(os.path.join(root, '.servicehost', 'token')) as f: token = f.read()
        assert self.headers['Authorization'] == 'Bearer ' + token
        assert self.headers['X-Servicehost-Project']
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        operations.append(body)
        action = body['action']
        if action == 'ping': result = {'project':self.headers['X-Servicehost-Project'], 'protocol':1}
        elif action == 'status': result = {'services':[
            {'name':'api','state':'running','readiness':'ready','output':'available','pid':12345,'port':3000},
            {'name':'worker','state':'stopped','readiness':'inactive','output':'unavailable'}]}
        elif action == 'log-follow': result = {'text':'' if body.get('cursor') else 'pty-live\n\x1b]52;c;hostile\x07hello 仕事\n', 'cursor':{'offset':32,'launchId':'a'*24}}
        else:
            assert action in ('stop','restart')
            time.sleep(.15)
            result = {'stopped':True}
        data = json.dumps(result).encode()
        self.send_response(200); self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

with tempfile.TemporaryDirectory(prefix='servicehost-panel-pty-') as root:
    server = http.server.HTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    with open(os.path.join(root,'ServiceHost.json'),'w') as f:
        json.dump({'apiPort':server.server_port,'logDirectory':'logs','services':[{'name':'api','command':sys.executable,'args':[],'workingDirectory':'.'}]},f)
    try:
        for mode in ('keys','signal','disconnect'):
            master, slave = pty.openpty()
            original = termios.tcgetattr(slave)
            fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,80,0,0))
            child = subprocess.Popen([os.environ.get('NODE','node'),cli,'panel'],cwd=root,stdin=slave,stdout=slave,stderr=slave)
            output = b''
            def until(marker):
                global output
                end = time.time()+8
                while marker not in output:
                    assert time.time()<end, ('PTY timeout',mode,output[-500:])
                    if select.select([master],[],[],.1)[0]: output += os.read(master,65536)
            try:
                until(b'pty-live')
                assert termios.tcgetattr(slave)[3] & termios.ICANON == 0
                assert b'\x1b]52' not in output
                assert b'> api running :3000' in output
                assert ('─' * 80).encode() in output
                assert b'Connected.' not in output and b'live output' not in output
                if mode == 'keys':
                    os.write(master,b'\x1bOP') # F1
                    until(b'Ownership:')
                    os.write(master,b'\x1bOP')
                    os.write(master,b'\x1bOR\x1bOR') # F3 twice: only one inflight action
                    until(b'stop api: completed')
                    assert len([x for x in operations if x['action']=='stop']) == 1
                    os.write(master,b'\x1b[B\x1b[17~') # select worker, hide list
                    until(b'No output for this runtime.')
                    os.write(master,b'\x0c')
                    until(b'View cleared; log files unchanged.')
                    fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',16,50,0,0));child.send_signal(signal.SIGWINCH)
                    time.sleep(.1)
                    os.write(master,b'\x11') # Ctrl+Q
                elif mode == 'signal': child.send_signal(signal.SIGTERM)
                else:
                    server.shutdown();server.server_close()
                    until(b'Disconnected; cached output. Controls disabled.')
                    os.write(master,b'q')
                child.wait(timeout=5)
                while select.select([master],[],[],.05)[0]: output += os.read(master,65536)
                assert child.returncode == 0
                assert b'\x1b[?1049h' in output and b'\x1b[?25h\x1b[?1049l' in output
                assert termios.tcgetattr(slave) == original, 'raw mode not restored'
            finally:
                if child.poll() is None: child.kill();child.wait()
                os.close(master);os.close(slave)
        assert not any(x['action'] in ('shutdown','start','adopt') for x in operations)
        print('PTY: keys, pending guard, clear, selection, resize, q/Ctrl+Q, SIGTERM, disconnect, raw/cursor/alternate-screen restoration passed')
    finally:
        server.shutdown();server.server_close()
