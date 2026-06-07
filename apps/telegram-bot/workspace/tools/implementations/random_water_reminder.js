import random, json, subprocess, os, sys

def handler():
    msgs = [
        "💧 Time to drink water!",
        "🧊 Hydration break!",
        "🚰 Grab a glass of water.",
        "💦 Stay refreshed, take a sip.",
        "🥤 Water time!"
    ]
    msg = random.choice(msgs)
    # Send via Telegram (assume send_telegram_message is available as env command)
    import requests, textwrap
    # Use internal function via subprocess? We'll call the provided tool via HTTP? Simplify: print the message and rely on cron to send.
    print(msg)

if __name__ == "__main__":
    handler()