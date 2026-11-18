# Cosmos Voyager

A little app for actually watching Carl Sagan's *Cosmos: A Personal Voyage*. It keeps your spot, breaks every episode into sections you can watch in 10–20 minutes, lets you take notes as you go, and points you at the parts that'll blow your mind.

## Why I made this

*Cosmos* came out in 1980 and it's still one of the best things ever put on television. Sagan wasn't just teaching facts about stars and planets. He was showing people how science works: how you ask a question, test it, and accept the answer even when it's not the one you wanted. He did it with so much wonder and so little condescension that you come out the other side feeling like the universe is something you're allowed to understand. Not just scientists. You.

That's the part I care about most. Science shouldn't be locked up in textbooks and journals for the people who already speak the language. It should be for everyone. Sagan called science a candle in the dark, and I think that's exactly right. It's how we tell what's real from what we wish were real, and how we keep from getting fooled. A culture that values that, that's curious and skeptical at the same time, is a culture that can actually solve its problems. That doesn't happen by accident. It happens because people get exposed to this stuff and it lights something up in them. *Cosmos* has done that for a lot of people, and it should keep doing it.

The problem is that it's honestly kind of a pain to watch right now. Most of it lives on the Internet Archive or on DVDs. Both are great for preserving it, and I'm grateful they exist, but neither one remembers where you left off. Each episode is an hour long, and most of us don't have an hour to sit down at once. So you watch 20 minutes, stop in the middle of a topic, come back a week later, and spend five minutes scrubbing around trying to find your place. Or you just don't come back.

The goal here is to make this series easier to get to and easier to digest:

- **It remembers your spot.** In every episode, every time.
- **Bite-sized sections.** Every episode is split into 4–6 sections at natural breaks where Sagan moves from one topic to the next, so when you stop, you're stopping at a good place and not halfway through a thought.
- **The best stuff, starred.** If you've only got 15 minutes, there are 24 starred sections that stand on their own: the Cosmic Calendar, Eratosthenes measuring the Earth with a stick, the Heike crabs, Flatland and the fourth dimension, the apple pie, and so on.
- **Up next.** One button that plays your next section and stops when it's done. That's it. Work through the whole series a piece at a time.
- **Notes.** Jot something down at any moment and it's pinned to that timestamp so you can jump back to it later.
- **Captions** for every episode.
- **Works on your phone** over your home Wi-Fi, and your place carries over between devices.

## Getting started

You need Python 3 installed. Nothing else to install for the app itself.

1. Double-click `start.cmd` (or run `python server.py`).
2. Your browser opens to http://localhost:8765.
3. Go to **Episodes → Download all** to grab the episodes (about 11 GB). Until an episode is downloaded it just streams from archive.org, so you can start watching right away.

### On your phone

Make sure your phone is on the same Wi-Fi as your computer, then click **📱 Open on phone** in the top right and scan the QR code. The server also prints the address when it starts, something like `http://192.168.1.x:8765`. In your phone's browser, use "Add to Home Screen" and it'll get its own icon like an app.

Your computer has to be on with the app running for this to work. It only answers devices on your home network, never the open internet. If your phone can't connect, Windows Firewall is probably blocking Python. Allow it on your network when Windows asks.

## Captions and transcripts

The section breaks were found by transcribing every episode with [Whisper](https://github.com/SYSTRAN/faster-whisper) and finding where the topic actually changes. The transcripts aren't included in this repo since they're the show's full narration. To make your own (and get captions), set up the Whisper environment and run:

```
py -3.12 -m venv .venv-whisper
.venv-whisper\Scripts\python -m pip install faster-whisper nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*" "av<17"
.venv-whisper\Scripts\python transcribe.py --watch
```

With an NVIDIA GPU it takes about two minutes an episode. Without one it falls back to the CPU and takes a lot longer.

## What's where

| Path | What it is |
|---|---|
| `server.py` | The whole backend. Plain Python, no dependencies. Serves the app, downloads episodes, saves your progress and notes. |
| `static/` | The app itself (HTML, CSS, JS). |
| `data/episodes.json` | The 13 episodes and their archive.org files. |
| `data/segments.json` | Every section: title, description, start time, and whether it's starred. Disagree with my picks? Edit it and reload. |
| `data/user.json` | Your progress, what you've watched, and your notes. Not in git. Back it up if you care about your notes. |
| `videos/` | Downloaded episodes. Not in git. |
| `transcribe.py` | Makes the transcripts and captions. |

## Credit where it's due

*Cosmos: A Personal Voyage* was written by Carl Sagan, Ann Druyan and Steven Soter, and all of it belongs to them and its rights holders. This app doesn't include any of the show. It just plays the copy the [Internet Archive](https://archive.org/details/CosmosAPersonalVoyage) already hosts. If this gets you into it, go buy the DVDs or read the book. And then go read *The Demon-Haunted World*.
