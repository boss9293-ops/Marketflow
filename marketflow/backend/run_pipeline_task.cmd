@echo off
cd /d "%~dp0"
python -X utf8 run_pipeline_scheduled.py >> output\pipeline_task.log 2>&1
