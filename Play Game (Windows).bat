@echo off
title Elf on the Shelf: Hollow Hill
cd /d "%~dp0"
rem Double-click this file to play on Windows. No installs needed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\serve.ps1"
