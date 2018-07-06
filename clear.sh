#!/bin/bash
pm2 stop all
pm2 delete all
pm2 flush
redis-cli flushall
rm -rf ./logs/*.log
rm -rf ./samples/*.wav
rm -rf ./matches/*.wav
