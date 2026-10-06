"""Local acceptance server; exits when its supervising process closes stdin."""

import os
import sys
import threading

import uvicorn


def main():
    server = uvicorn.Server(uvicorn.Config("text_safety.main:app", host="127.0.0.1",
        port=int(sys.argv[1]), access_log=False, log_level="warning"))

    def supervise():
        sys.stdin.read()
        server.should_exit = True

    print("API_WORKER_PID " + str(os.getpid()), flush=True)
    threading.Thread(target=supervise, daemon=True).start()
    server.run()


if __name__ == "__main__":
    main()
