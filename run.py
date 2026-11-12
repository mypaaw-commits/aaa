"""Local launcher; does not install packages or modify model files."""
import argparse
import errno
import socket
import threading
import time
import urllib.request
import webbrowser


def reserve_listener(port):
    """Reserve this launcher's address before opening any browser window."""
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        try:
            listener.bind(('127.0.0.1', port))
        except OSError as error:
            if error.errno != errno.EADDRINUSE and getattr(error, 'winerror', None) != 10048:
                raise
            listener.bind(('127.0.0.1', 0))
        listener.listen(128)
        return listener
    except BaseException:
        listener.close()
        raise


def main():
    import uvicorn
    from backend.main import app
    parser = argparse.ArgumentParser(description='ModelCheck 3D — lokalny prototyp')
    parser.add_argument('--version', action='version', version=f'ModelCheck 3D {app.version}')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    listener = reserve_listener(args.port)
    port = listener.getsockname()[1]
    print(f'ModelCheck 3D {app.version}: http://127.0.0.1:{port}', flush=True)
    if port != args.port:
        print('The previous port is in use. This copy uses a different address.', flush=True)
    print('Keep this window open while using the application. Close it to stop.', flush=True)
    if not args.no_browser:
        def open_browser():
            for _ in range(50):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=.5) as response:
                        if response.status == 200:
                            webbrowser.open(f'http://127.0.0.1:{port}')
                            return
                except OSError:
                    time.sleep(.2)
        threading.Thread(target=open_browser, daemon=True).start()
    try:
        # Explicit implementations also work in a frozen executable: optional
        # event-loop and WebSocket packages are not needed by this application.
        config = uvicorn.Config(app, host='127.0.0.1', port=port,
                                loop='asyncio', http='h11', ws='none', lifespan='on')
        uvicorn.Server(config).run(sockets=[listener])
    finally:
        listener.close()


if __name__ == '__main__':
    from multiprocessing import freeze_support
    freeze_support()
    main()
