# What's left to build and test

- [x] Re-read `Collection.save` documentation
- [x] Split the documentation
- [x] Be sure that indexing is explained properly
- [ ] indexModel apply on existing docs, "rollback"-able to allow some room for type misfits?
  - [x] add a method to make a "dry run" of a indexModel change. The method will iterate and validate each document against the new indexModel. No change will be made on the docs/collection though. But this method can prevent us from having to design a "rollback"-able indexModel change...
  - [ ] Adding an operation queue is good idea to block the flow and dodge race condition. Or a "lock" state variable
  - [ ] WHAT DOES "doNotApplyModel" ENTAIL???
- [ ] Add more "unique" & "index" flags test vectors
- [ ] Add automatic type casting, allowing flexibility when saving a document or migrating index models
- [ ] Add checks for "index" flag in `validateIndexModel`
- [x] Add tests for 1-node tree iteration
- [x] Handle the case where a document's size is bigger than the `_nodeMaxSize` - to split a tree leaf, the conditions to be met are (currentSize >= maxNodeSize && currentRange.width > 0)
- [x] Reduce the default dateGranularity to 1ms
- [x] Add `meta.indexVersions`, to store the index file and formats versions
- [x] Check that, when unloading an index fragment, the latest changes are saved, if needed...
- [ ] indexes on `index: true` flag in indexModel. will work best string, buffers, boolean(what about largely uneven distribution?) and dates(?)
  - [x] ~~boolean index, 2 subtrees~~
    * ~~one for `true`, one for `false`~~
    * ~~where <Key,Value> would be <DocId, SubtreeValue(true||false)>~~
    * ~~to check whether a doc has true or false on the indexed attribute, we perform a lookup on both trees~~
    * ~~this solution ignores the documents that left the indexed attribute undefined (which is what we want?)~~
    * ~~how is it stored on disk?~~
    * ~~see how cryptDB deals with booleans?~~
    * boolean indices will be built on a <DocId, BooleanValue> unique index
  - [ ] or how to deal with unread message in lockateme? A special collection that contains the IDs of these unread messages... Much faster to implement, and potentially more secure? (the name of the collection, `unreadmessages` is in plaintext however, and its size on disk can let an attacker "guess" how many unread messages you have, maybe)
  - [x] dates & number index
    - [x] ~~-> get inspired by cryptDB~~
    - [x] string encoding for numbers (and decimals!), that respect order/lexicographical relation. But that won't fix the problem you will have with the Pearson hashing function (loss of order)
    - [ ] Rethink date granularity
- [x] use indexes for unique value and id existence checks
- [ ] use indexes in compound queries, using them to build a data subset when possible (on which the rest of the query will be ran)
- [ ] Write some more `save` and `bulkSave` examples
- [ ] reorganize the parameters of `retrieveIndexDocsMatchingQuery()`
- [ ] document the new indexModel API
- [x] test clearIndexModel
- [x] Native Cordova crypto_secretbox_easy plugin, for iOS and Android
  - [x] crypto_secretbox_easy
  - [x] crypto_secretbox_open_easy
- [x] SetSecretboxProvider method, like with Scrypt
- [ ] How to count docs and determine the size of the collection, without performing useless writes?
  - [ ] Re-read how it was done in v1, to see exactly what was measured...
  - [ ] Timed-out writes to meta? Like every 5 seconds (like with TTLs)?
  - [ ] Add a method to update size and doc count counters (that will receive +/- n bytes / +/- n docs as parameters)
- [x] Write a threat model
  - [x] Attackers can read FS, but not app memory
    -> collection names, blob names, and indexed attributes' names must not contain sensitive information
  - [x] Attackers cannot monitor Lawncipher calls, but can monitor FS activity

## For v2.1
- [ ] Add an optional "default" value for a given field in IndexModel
- [ ] `$fuzzy`, `$contain`/`$like`, `$fuzzylike`  matching on strings
