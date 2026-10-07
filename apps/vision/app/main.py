import os
import sys

from fastapi import FastAPI

VERSION = "0.1.0"

app = FastAPI(title="vision", version=VERSION)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "version": VERSION,
        "python": sys.version.split()[0],
        "device": "cpu",
        "model": None,
    }


def run() -> None:
    import uvicorn

    port = int(os.environ.get("VISION_PORT", "7879"))
    uvicorn.run(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    run()
