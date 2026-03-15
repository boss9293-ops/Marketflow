@echo off
cd /d "%~dp0"
python run_all.py >> output\pipeline_task.log 2>&1
