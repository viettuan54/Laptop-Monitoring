import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "text_safety.main:app",
        host="127.0.0.1",
        port=8100,
        access_log=False,
    )
