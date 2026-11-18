@echo off
rem Cosmos Voyager: starts the local server and opens the app in your browser.
cd /d "%~dp0"
start "" http://localhost:8765
python server.py
