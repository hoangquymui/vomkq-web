"""Run isolated browser regressions; only synthetic test databases are used."""
import argparse
import json
import subprocess
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", required=True)
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    finished = threading.Event()
    result = {}

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            if self.path != "/runtime-test-result":
                self.send_error(404)
                return
            result.update(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(204)
            self.end_headers()
            finished.set()

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(project)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix="vector-runtime-browser-") as profile:
            command = [args.browser, "--headless", "--disable-gpu", "--no-first-run",
                       "--no-default-browser-check", "--disable-background-networking",
                       f"--user-data-dir={profile}",
                       f"http://127.0.0.1:{server.server_port}/scripts/check_runtime.html?report=1"]
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                if not finished.wait(40):
                    raise RuntimeError("Browser tests did not finish within 40 seconds")
                for line in result["results"]:
                    print(line, flush=True)
                print(json.dumps({key: value for key, value in result.items() if key != "results"}), flush=True)
                if result["passed"] != result["total"]:
                    raise RuntimeError("Runtime regression failed")
            finally:
                # Stop only the browser process tree created for this isolated profile.
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                process.wait(timeout=10)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
