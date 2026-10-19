"""Local launcher; does not install packages or modify model files."""
import argparse
import threading
import time
import urllib.request
import webbrowser

if __name__ == '__main__':
    import uvicorn
    parser = argparse.ArgumentParser(description='ModelCheck 3D — lokalny prototyp')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not args.no_browser:
        def open_browser():
            for _ in range(50):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{args.port}/api/health', timeout=.5) as response:
                        if response.status == 200:
                            webbrowser.open(f'http://127.0.0.1:{args.port}')
                            return
                except OSError:
                    time.sleep(.2)
        threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run('backend.main:app', host='127.0.0.1', port=args.port)
