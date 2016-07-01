#! /bin/sh

if [ ! -d "test_migration_v1/lawncipher_v1" ]; then
  git clone --branch v1.0.4 https://github.com/LockateMe/Lawncipher.git test_migration_v1/lawncipher_v1
fi
if [ -d "test_migration_v1/test_db" ]; then
  rm -r test_migration_v1/test_db
fi
if [ -d "test_migration_v1/test_data" ]; then
  rm -r test_migration_v1/test_data
fi

node migrate_pre.js
node migrate_post.js
