#! /bin/bash

set -e

if [[ -z "$1" || -z "$2" ]]; then
	echo "usage: ./stress.sh nTimes node_test_file.js"
	exit
fi

for ((a=1; a<=$1 ; a++))
do
	node $2 $3 $4 $5 $6 $7 $8 $9
done
