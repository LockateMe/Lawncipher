/*
* Lawnchair-inspired libsodium-backed encrypted persistent document storage
*/
(function(root, factory){
	var _nodeContext = false;
	if (typeof process === 'object' && process != null){
		_nodeContext = true;
	}
	/*if (typeof process === "object" && typeof process.stdout === "undefined") {
		process.stderr = process.stdout = { write: console.log };
	}*/
	if (typeof define === 'function' && define.amd){
		define(['exports', 'sodium', 'console', _nodeContext.toString(), 'require', 'window'], factory);
	} else if (typeof exports !== 'undefined'){
		factory(exports, require('libsodium-wrappers'), console, _nodeContext, require, !_nodeContext ? window : undefined);
	} else {
		var cb = root.Lawncipher && root.Lawncipher.onload;
		factory((root.Lawncipher = {}), sodium, console, _nodeContext, typeof require != 'undefined' && require, !_nodeContext ? window : undefined);
		if (typeof cb == 'function'){
			cb(root.Lawncipher);
		}
	}

}(this, function(exports, sodium, console, nodeContext, require, window){

	var initCalled = false;
	var fs, pathJoin;
	var randomBuffer

	//Adding an init method when not running in Node or in one of its derivatives
	if (!nodeContext){
		pathJoin = _pathJoin;

		randomBuffer = function(size){
			if (!(typeof size == 'number' && size > 0 && Math.floor(size) == size)) throw new TypeError('size must be a strictly positive integer');
			var b = new Uint8Array(size);
			window.crypto.getRandomValues(b);
			return b;
		};

		exports.init = function(_fs){
			if (initCalled) throw new Error('Lawncipher.init has already been called');
			if (!(typeof _fs == 'object' && _fs != null)) throw new TypeError('_fs must be a non-null object');

			fs = _fs;
			initCalled = true;
		};
	} else {
		initCalled = true; //Init call not needed (and not possible) outside of Nodejs
		fs = require('fs');
		pathJoin = require('path').join;

		var crypto = require('crypto');

		randomBuffer = function(size){
			if (!(typeof size == 'number' && size > 0 && Math.floor(size) == size)) throw new TypeError('size must be a strictly positive integer');
			var rand = crypto.randomBytes(size);

			var ab = new ArrayBuffer(rand.length);
			var ua = new Uint8Array(ab);
			for (var i = 0; i < rand.length; i++) ua[i] = rand[i];
			return ua;
		}
	}

	if (!sodium) throw new Error('Error on loading Lawncipher : Libsodium is missing');

	var from_hex = sodium.from_hex, to_hex = sodium.to_hex, from_base64 = sodium.from_base64, to_base64 = sodium.to_base64;
	var from_string = sodium.string_to_Uint8Array || sodium.from_string, to_string = sodium.uint8Array_to_String || sodium.to_string;

	var cryptoFileEncoding = {
		encrypt: scryptFileEncode,
		decrypt: scryptFileDecode,
		decode: scryptFileDecodeHeader
	};

	//var defaultScryptParams = {r: 8, p: 1, opsLimit: 16384};
	var minFileSize = sodium.crypto_secretbox_NONCEBYTES + sodium.crypto_secretbox_MACBYTES + 1;
	var collectionIndexFileModel = {
		indexModel: null,
		documents: {},
		docCount: 0,
		collectionSize: 0 //The summed-up sizes of all collection blobs. Index size not taken into account
	};
	var permittedIndexTypes = ['string', 'date', 'number', 'boolean', 'object', 'array', 'buffer', '*'];
	var purgeIntervalValue = 5000;

	var maxIndexChunkSize = 1 << 21; //(2 ^ 21). Lawncipher prevents itself from writing enourmous index files. If the unencrypted index file exceeds this size (in unencrypted state), it will be chunked.

	var indexNamesRegex = /^_index(?:\d+)?$/g;

	exports.db = Lawncipher;

	function Lawncipher(rootPath){
		if (!initCalled) throw new TypeError('Lawncipher.init must be called before a Lawncipher.db can be initialized');

		if (!(typeof rootPath == 'string' && rootPath.length > 0)) throw new TypeError('rootPath must be a non-null string');

		var rootKey;
		var collectionIndex;
		var collectionIndexPath = pathJoin(rootPath, '_index');

		var openCollections = [];

		var lc = this;

		/**
		* Open the lawncipher document store
		* @param {String} _rootKey - the root key from which each collection's main encryption key will be derived. If lawncipher is empty, the provided rootKey will be set; if it isn't empty, it has to match the rootKey that was provided on creation
		* @param {Function} callback - callback function. Receiving only an `err` (error) parameter (a string)
		*/
		this.open = function(_rootKey, callback){
			if (!_rootKey) return false; //No root key provided
			if (rootKey) return false; //Already open
			if (typeof callback != 'function') throw new Error('callback must be a function');

			if (!(_rootKey instanceof Uint8Array && _rootKey.length == sodium.crypto_secretbox_KEYBYTES)){
				callback(new Error('rootKey must be an Uint8Array and ' + sodium.crypto_secretbox_KEYBYTES + ' bytes long'));
				return;
			}

			rootKey = _rootKey;

			//Checking wether the root folder exists. Creating it otherwise. Loading main lawncipher `_index` file
			fs.exists(rootPath, function(exists){
				if (!exists){
					fs.mkdirp(rootPath, function(err){
						if (err){
							console.error('Error while creating root folder for lawnchiper: ' + err);
							callback(err);
							return;
						}
						setTimeout(loadMainIndex, 0);
					});
				} else {
					setTimeout(loadMainIndex, 0);
				}
			});

			function loadMainIndex(){
				//Checking whether the main `_index` file exists.
				fs.exists(collectionIndexPath, function(exists){
					if (exists){
						fs.readFile(collectionIndexPath, function(err, collectionIndexBuffer){
							if (err){
								console.error('Error while reading the collectionIndex file');
								callback(err);
								return;
							}

							var collectionIndexStr;
							try {
								collectionIndexStr = cryptoFileEncoding.decrypt(collectionIndexBuffer, rootKey);
								collectionIndexStr = to_string(collectionIndexStr);
							} catch (e){
								rootKey = undefined;
								callback('INVALID_ROOTKEY');
								return;
							}

							var _collectionIndex;
							try {
								_collectionIndex = JSON.parse(collectionIndexStr);
							} catch (e){
								callback('INVALID_INDEX');
								return;
							}
							if (!Array.isArray(_collectionIndex)){
								callback('INVALID_INDEX');
								return;
							}
							collectionIndex = _collectionIndex;
							setTimeout(loadCollections, 0);
						}, true);
					} else {
						collectionIndex = [];
						saveIndex(callback);
						//fs.writeFile(collectionIndexPath, '[]', callback); //Creating it otherwise. If we are creating the root lawncipher index file, that means there no collections yet. Callback
					}
				});
			}

			//Loading collections. Or more precisely checking their description format. But why?
			function loadCollections(){
				if (collectionIndex.length == 0){
					//console.log('No collection description to load');
					callback();
					return;
				}

				var endCount = 0;

				for (var i = 0; i < collectionIndex.length; i++){
					loadOne(collectionIndex[i]);
				}

				function endLoad(){
					if (endCount == collectionIndex.length){
						//console.log('Collections loaded');
						callback();
					}
				}

				function loadOne(c){
					var missingVarName;
					if (!c['name']) missingVarName = 'name';
					if (!c['key']) messageVarName = 'key;'
					if (missingVarName){
						console.error('Missing variable ' + missingVarName + ' from collection description ' + JSON.stringify(c));
						endCount++;
						endLoad();
						return;
					}

					//Default TTL parameter to be included here as well??

					endCount++;
					endLoad();
					//Why async-like code when behavior is sync?
				}
			}
		};

		/**
		* Closing the lawncipher, if open
		*/
		this.close = function(){
			//Trying to attract the GC's attention by setting the `rootKey` and `collectionIndex` to null
			if (rootKey || collectionIndex){
				rootKey = null;
				collectionIndex = null;
			}
			while (openCollections.length > 0){
				openCollections[0].close();
				openCollections.splice(0, 1);
			}
		};

		/**
		* Checking whether the lawncipher is open or not.
		* @returns {Boolean}
		*/
		this.isOpen = function(){
			return !!(rootKey && collectionIndex);
		};

		/**
		* Setting a new root key and re-encrypt collection's indexes
		* @param {Uint8Array} newRootKey - the new root key to be used in lawncipher
		* @param {Function} callback - receving (err), defined if an error occured
		*/
		this.changeRootKey = function(newRootKey, callback){
			if (!(newRootKey && (newRootKey instanceof Uint8Array && newRootKey.length == sodium.crypto_secretbox_KEYBYTES))) throw new TypeError('newRootKey must be an Uint8Array and ' + sodium.crypto_secretbox_KEYBYTES + ' bytes long');
			if (typeof callback != 'function') throw new TypeError('callback must be a function');

			if (!(rootKey && collectionIndex)){
				callback(new Error('lawncipher is not open yet'));
				return;
			}

			rootKey = newRootKey;
			saveIndex(callback);
		};

		/**
		* Getting an existing collection, or creating one
		* @param {String} name - the collection's name
		* @param {Object|Array<String>} [_indexModel] - the index model. The attributes that will be extracted and/or saved in the collection's _index file. The query-able data. If the collection already exists, this parameter will simply be ignored. Optional parameter.
		* @param {Function} _callback - callback function, receiving errors or the constructed Collection object (err, collection)
		*/
		this.collection = function(name, _indexModel, _callback){
			if (typeof name != 'string') throw new TypeError('name must be a string');

			//Possibility to skip the _index model parameter. Testing types to find the mandatory callback
			var indexModel, callback;
			if (typeof _indexModel == 'function'){
				callback = _indexModel;
			} else if (typeof _indexModel == 'object'){
				indexModel = _indexModel;
			}
			if (typeof _callback == 'function' && typeof _indexModel != 'function') callback = _callback;
			if (!callback) throw new TypeError('callback must be a function');

			if (!lc.isOpen()){
				callback(new Error('lawncipher is not open yet'));
				return;
			}

			var c = new Collection(name, indexModel, callback);
			openCollections.push(c);

			return c; //Returning the new Collection object, that will call the `callback` as well. If the returned lawncipher instance is used before the callback is executed, race condition guaranteed.
		};

		/**
		* Getting the names of existing collections
		* @param {Function} _callback - callback function, receiving (err, names)
		* @returns {Array<String>}
		*/
		this.collections = function(_callback){
			if (typeof _callback != 'function') throw new TypeError('_callback must be a function');

			//Do we really want to forbid this operation if the lawncipher is not open? Even if it doesn't depend on the rootKey/crypto?
			//Could potentially and easily be overriden by standard fs...
			if (!lc.isOpen()){
				callback(new Error('lawncipher is not open yet'));
				return;
			}

			var collectionsNames = [];
			for (var i = 0; i < collectionIndex.length; i++) collectionsNames.push(collectionIndex[i].name);
			_callback(undefined, collectionsNames);
			return collectionsNames;
		};

		/**
		* Deleting an existing collection. Note that this operation cannot be undone.
		* @param {String} collectionName - the name of the collection to be dropped
		* @param {Function} callback - callback function, receiving (err), a string briefly describing the error, if one occured
		*/
		this.dropCollection = function(collectionName, callback){
			if (typeof callback != 'function') throw new TypeError('callback must be a function');
			if (typeof collectionName != 'string'){
				callback(new TypeError('collectionName must be a string'));
				return;
			}

			//Do we really want to forbid this operation if the lawncipher is not open? Even if it doesn't depend on the rootKey/crypto?
			//Could potentially and easily be overriden by standard fs...
			if (!lc.isOpen()){
				callback(new Error('lawncipher is not open yet'));
				return;
			}

			var collectionPosition;
			for (var i = 0; i < collectionIndex.length; i++){
				if (collectionIndex[i].name == collectionName){
					collectionPosition = i;
					break;
				}
			}

			//Recursively deleting the collection's folder
			var docsPath = pathJoin(rootPath, collectionName);
			fs.rmdirr(docsPath, function(err){
				if (err){
					console.error('Error while dropping documents files of collection ' + collectionName + ': ' + err);
					callback(err);
					return;
				}
				//Removing the collection from the main index and saving it
				collectionIndex.splice(collectionPosition, 1);
				saveIndex(function(err){
					if (err) console.error('Error while saving new collection index, after dropping collection ' + collectionName + ': ' + err);
					callback(err);
				});
			});

		};

		/**
		* Save the root lawncipher index
		* @private
		* @param {Function} callback - callback function, receiving potential error messages as strings. If the provided value is not a function, the function silently returns
		*/
		function saveIndex(cb){
			if (typeof cb != 'function') return;
			/*fs.unlink(collectionIndexPath, function(err){
				if (err){
					console.error('Error while deleting master (collections) index file: ' + err);
					//cb(err);
				}
				fs.writeFile(collectionIndexPath, JSON.stringify(collectionIndex), cb);
			});*/
			var collectionIndexStr = JSON.stringify(collectionIndex);
			var fileSalt = randomBuffer(16); //Placeholder salt. The real one is the one in the identity key file
			var encryptedIndexBuffer = cryptoFileEncoding.encrypt(from_string(collectionIndexStr), rootKey, fileSalt);
			fs.writeFile(collectionIndexPath, encryptedIndexBuffer, cb);
		}

		/**
		* Lawncipher Collection object constructor
		* @constructor
		* @private
		* @param {String} name - collection name. If a collection with this name already exists, it is loaded. Otherwise, a new collection will be created, using the current rootKey.
		* @param {Object|Array<String>} indexModel - the document model to be used for this collection. This parameter is ignored if the collection already exists.
		* @param {Function} cb - callback function receiving (err, collection). File, format and rootKey errors can occur.
		*/
		function Collection(name, indexModel, cb){
			var k; //The collection's main encryption key
			var self = this;
			indexModel = indexModel && clone(indexModel);
			var collectionName = name;
			var collectionIndexModel = indexModel;
			var docCount = 0;
			var collectionSize = 0;
			var collectionIndexSize = 0;

			var purgeInterval, purgeOngoing = false;

			if (collectionIndexModel && validateIndexModel(collectionIndexModel)){
				cb('Invalid descripton for index field ' + validateIndexModel(collectionIndexModel));
				return;
			}

			var collectionDescription; //The object to be added to the collection list, describing the current collection
			var collectionPath = pathJoin(rootPath, collectionName); //Root directory of the collection
			var indexFilePath = pathJoin(collectionPath, '_index'); //Index file of the collection
			var documentsIndex = null; //Decrypted, parsed and deserialized contents of the index file. Object joining indexModel, documents, docCount & collectionSize
			var serializedIndex = null; //Decrypted, parsed and serialized contents of the index file. Object joining indexModel, documents, docCount & collectionSize

			for (var i = 0; i < collectionIndex.length; i++){
				if (collectionIndex[i].name == name){
					collectionDescription = collectionIndex[i];
					break;
				}
			}

			if (!collectionDescription){
				collectionDescription = {
					name: collectionName,
					key: to_hex(randomBuffer(32))
				};

				if (collectionIndexModel) collectionDescription.indexModel = clone(collectionIndexModel)

				collectionIndex.push(collectionDescription);
				saveIndex(function(err){
					if (err){
						cb(err);
						return;
					}

					loadDocumentsIndex();
				});
			} else loadDocumentsIndex();

			function loadDocumentsIndex(){
				fs.exists(indexFilePath, function(indexExists){
					if (indexExists){
						function l(){ //Load existing index
							fs.readFile(indexFilePath, function(err, data){
								if (err){
									console.error('Error while reading index file for collection ' + collectionName + ': ' + err);
									cb(err);
									return
								}

								//var encryptedFileBuffer = from_base64(data);
								var encryptedFileBuffer = data;
								collectionIndexSize = data.length;
								if (encryptedFileBuffer.length < minFileSize){
									console.error('Error while reading index file for collection ' + collectionName + ': invalid file size');
									cb('INVALID_INDEX');
									return;
								}

								var nonceBuffer = new Uint8Array(sodium.crypto_secretbox_NONCEBYTES);
								for (var i = 0; i < sodium.crypto_secretbox_NONCEBYTES; i++){
									nonceBuffer[i] = encryptedFileBuffer[i];
								}
								var cipherBuffer = new Uint8Array(encryptedFileBuffer.length - nonceBuffer.length);
								for (var i = 0; i < cipherBuffer.length; i++){
									cipherBuffer[i] = encryptedFileBuffer[sodium.crypto_secretbox_NONCEBYTES + i];
								}

								//if (!k) k = sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, rootKey, from_hex(collectionDescription.salt));
								if (!k) k = from_hex(collectionDescription.key);

								var decryptedIndexStr = sodium.crypto_secretbox_open_easy(cipherBuffer, nonceBuffer, k, 'text');
								if (!decryptedIndexStr){
									console.error('Can\'t decrypt index file for collection ' + collectionName);
									cb('INVALID_ROOTKEY');
									return;
								}

								try {
									serializedIndex = JSON.parse(decryptedIndexStr);
								} catch (e){
									cb('INVALID_INDEX');
									return;
								}

								//Deserialize every object in the index
								documentsIndex = {indexModel: serializedIndex.indexModel, documents: {}, docCount: serializedIndex.docCount, collectionSize: serializedIndex.collectionSize};
								var docsIds = Object.keys(serializedIndex.documents);
								for (var i = 0; i < docsIds.length; i++){
									documentsIndex.documents[docsIds[i]] = clone(serializedIndex.documents[docsIds[i]]);
									documentsIndex.documents[docsIds[i]].index = deserializeObject(documentsIndex.documents[docsIds[i]].index);
								}

								//Checking that if an indexModel is provided as a parameter of this call, it hasn't changed with the one already saved on file.
								if (indexModel && documentsIndex.indexModel){
									if (!deepObjectEquality(documentsIndex.indexModel, indexModel)){
										//If it does, update
										console.log('Updating indexModel of collection ' + collectionName + ' to ' + JSON.stringify(indexModel));
										documentsIndex.indexModel = indexModel;
										serializedIndex.indexModel = indexModel;
										collectionDescription.indexModel = indexModel;
										saveIndex(function(err){ //Saving root Lawncipher index (updating collection description)
											if (err){
												cb(err);
												return;
											}
											saveDocumentsIndex(function(err){ //Saving collection index, with updated indexModel attribute
												if (err){
													cb(err);
													return;
												}
												endCollectionLoad();
											});
										});
									} else {
										//Else : provided indexModel is the same as is already used by collection (namely, indexModel ==== documentsIndex.indexModel). No change to be done
										endCollectionLoad();
									}
								} else {
									indexModel = documentsIndex.indexModel;
									endCollectionLoad();
								}

								function endCollectionLoad(){
									purgeInterval = setInterval(ttlCheckAndPurge, purgeIntervalValue)
									cb(undefined, self);
								}
							}, true);
						}

						setTimeout(l, 0);
					} else {
						function c(){
							//Creating new documents index, encrypting and saving it. Given the indexModel...
							var newDocumentsIndex = clone(collectionIndexFileModel);
							if (indexModel) newDocumentsIndex.indexModel = indexModel;
							documentsIndex = newDocumentsIndex;
							serializedIndex = clone(documentsIndex);

							fs.mkdirp(collectionPath, function(err){
								if (err){
									cb(err);
									return;
								}
								saveDocumentsIndex(function(err){
									if (err){
										cb(err);
										return;
									}
									purgeInterval = setInterval(ttlCheckAndPurge, purgeIntervalValue);
									cb(undefined, self)
								});
							});
						}

						setTimeout(c, 0);
					}
				});
			}

			function serializeObject(o){ //Serializing date and buffer values to string, and preventing mix-up with strings
				if (!(typeof o == 'object' && o != null)){
					return o;
				}
				if (Array.isArray(o)){
					var serializedArray = new Array(o.length);
					for (var i = 0; i < o.length; i++){
						serializedArray[i] = serializeObject(o[i]);
					}
					return serializedArray;
				}
				o = clone(o);
				var objAttributes = Object.keys(o);
				//Search for strings in blob. Prefix them with "$string"
				//Search for dates in blob. Prefix them with "$date"
				for (var i = 0; i < objAttributes.length; i++){
					var currentValue = o[objAttributes[i]];
					if (typeof currentValue == 'string'){
						o[objAttributes[i]] = '$string:' + currentValue;
						continue;
					}
					if (currentValue instanceof Date){
						o[objAttributes[i]] = '$date:' + currentValue.getTime();
						continue;
					}
					if (currentValue instanceof Uint8Array){
						o[objAttributes[i]] = '$buffer:' + to_string(currentValue);
						continue;
					}
				}
				return o;
			}

			function deserializeObject(o){ //Deserializing date and buffer values
				if (!(typeof o == 'object' && o != null)){
					return o;
				}
				if (Array.isArray(o)){
					var deserialzedArray = new Array(o.length);
					for (var i = 0; i < o.length; i++){
						deserialzedArray[i] = deserializeObject(o[i]);
					}
					return deserialzedArray;
				}
				o = clone(o);
				var objAttributes = Object.keys(o);
				for (var i = 0; i < objAttributes.length; i++){
					var currentValue = o[objAttributes[i]];
					if (typeof currentValue == 'string'){
						if (currentValue.indexOf('$date:') == 0){
							currentValue = currentValue.substring('$date:'.length);
							currentValue = Number(currentValue);
							if (isNaN(currentValue)){
								cb('INVALID_DATE_FORMAT');
								return;
							}
							currentValue = new Date(currentValue);
						} else if (currentValue.indexOf('$string:') == 0){
							currentValue = currentValue.substring('$string:'.length);
						} else if (currentValue.indexOf('$buffer:') == 0){
							currentValue = from_string(currentValue.substring('$buffer:'.length));
						}
						o[objAttributes[i]] = currentValue;
					}
				}
				return o;
			}

			this.save = function(blob, index, cb, overwrite, ttl, doNotWriteIndex){
				if (typeof cb != 'function') throw new TypeError('callback must be a function');
				var fileData, indexData, docId, docIndexObj, serializedDocIndexObj;
				//If not blob, just save index data
				var noBlob = false;
				var tb = typeof blob;
				var blobType;
				if (tb == 'string'){
					fileData = blob;
					blobType = 'string'
				} else if (blob instanceof Uint8Array){ //Casting into string
					fileData = blob;
					blobType = 'buffer';
				} else if (blob && tb == 'object'){ //Ensuring object and not null. Works for arrays as well
					//Clone blob and serialize it
					var serializedBlob = serializeObject(blob);
					fileData = JSON.stringify(serializedBlob);
					blobType = 'json'
				} else noBlob = true; //No valid blob found

				if (ttl){
					if (!(typeof ttl == 'number' || ttl instanceof Date)){
						cb('INVALID_TTL');
						return;
					}
					if (ttl instanceof Date) ttl = ttl.getTime();
				}

				//console.log('Blob type: ' + blobType);

				if (index){
					//console.log('Index data');
					//When defined, `index` is either an object or an array (ie, an object as well from `typeof` point of view)
					if (typeof index != 'object'){
						cb('INVALID_INDEX');
						return;
					}

					if (Array.isArray(index)){
						if (tb != 'object' || Array.isArray(blob) || blob instanceof Uint8Array){
							//If the blob is not an object or is an array, index properties cannot be extracted
							cb('CANNOT_EXTRACT_INDEX_FROM_DOC');
							return;
						}
						indexData = {};
						for (var i = 0; i < index.length; i++){
							if (typeof index[i] != 'string'){
								cb('INVALID_FIELD_NAME');
								return;
							}
							indexData[index[i]] = blob[index[i]];
						}
					} else {
						//Use `index` value as index data
						indexData = clone(index);
						//Cloning in data so we can make sure that saved and re-saved docs aren't altered by modifications on the original indexData
					}

					if (indexModel){
						//Validation of index data against the model
						var validationResult = validateIndexAgainstModel(indexData, indexModel);
						if (typeof validationResult == 'string' || !validationResult){ //In case a field name or nothing is returned by the validation, error
							console.error('validationResult: ' + JSON.stringify(validationResult));
							cb('INVALID_INDEX_DATA');
							return;
						}
						//Else, Returned an object containing the validated data
						//Extracted supposed id and unique fields

						//Using the validated data as indexData
						//Meaning that, when you use a model, docs that have extra-model attributes will have them removed in the db
						indexData = validationResult;
						var indexFields = Object.keys(indexModel);
						var idField = null, uniqueFields = [];
						for (var i = 0; i < indexFields.length; i++){
							if (indexModel[indexFields[i]].id){
								if (!idField) idField = indexFields[i];
							}
							if (indexModel[indexFields[i]].unique){
								uniqueFields.push(indexFields[i]);
							}
						}
						//Check for ID and value unicity, according to the model
						if (idField){
							docId = indexData[idField];
							//Check that the user-provided docId isn't an index name
							if (indexNamesRegex.test(docId)){
								cb('INVALID_DOCID');
								return;
							}

						}
						var uniqueId = docId && checkIdIsUnique(docId);
						if (docId && !uniqueId){
							if (overwrite){
								removeDoc(docId, function(err){
									if (err){
										cb(err);
										return;
									}
									checkFieldsUniticy();
								});
								return;
							} else {
								cb('DUPLICATE_ID');
								return;
							}
						}

						//If there are `unique` fields or marked as `id`, then check for unicity before saving the doc
						if ((docId && uniqueId) || uniqueFields.length > 0) checkFieldsUniticy();
						else save(); //Otherwise, save the doc now

						function checkFieldsUniticy(){
							for (var i = 0; i < uniqueFields.length; i++){
								if (!checkFieldIsUnique(uniqueFields[i], indexData[uniqueFields[i]])){
									cb('DUPLICATE_UNIQUE_VALUE');
									return;
								}
							}
							save();
						}
					} else {
						//No validation to be done
						save();
					}
				} else {
					//console.log('No index data');
					if (noBlob){
						//If there is no blob nor index, what should I store then?
						cb('NO_DATA');
						return;
					} else {
						//There is a blob, but no index data. Generating a random doc ID
					}
					save();
				}


				function save(){
					saveDoc(docId, fileData, indexData, blobType, ttl, cb, doNotWriteIndex);
				}
			};

			this.bulkSave = function(blobs, indices, cb, overwrite, ttl){
				if (typeof cb != 'function') throw new TypeError('cb must be a function');
				if (blobs && !Array.isArray(blobs)){
					cb(new TypeError('when defined, blobs must be an array'));
					return;
				}
				if (indices && !Array.isArray(indices)){
					cb(new TypeError('when defined, indices must be an array'));
					return;
				}
				if (!(blobs || indices)){
					cb(new TypeError('either blobs or indices must be defined'));
					return;
				}
				if (!xor(blobs, indices)){
					//Meaning in this case that both of them are defined
					//Check length
					if (blobs.length != indices.length){
						cb(new RangeError('when both blobs and indices are defined, they must have the same length'));
						return;
					}
				}

				var dataLength = (blobs || indices).length;

				if (ttl){
					if (!(typeof ttl == 'number' || ttl instanceof Date || Array.isArray(ttl))){
						cb(new TypeError('ttl must either be a number, a date instance or an array'));
						return;
					}
					if (Array.isArray(ttl)){
						if (ttl.length != dataLength){
							cb(new TypeError('when ttl is an array, it must have the same length as the data to be saved'));
							return;
						}
						for (var i = 0; i < ttl.length; i++){
							if (!(typeof ttl[i] == 'number' || ttl[i] instanceof Date)){
								cb(new TypeError('ttl[' + i  + '] is not a valid TTL value'));
								return;
							}
						}
					} else {
						var ttlValue = ttl;
						ttl = new Array(dataLength);
						for (var i = 0; i < dataLength; i++) ttl[i] = ttlValue;
					}
				}

				var docIDs = [];
				var saveIndex = 0;
				var isLast = false;
				function saveOne(){
					self.save(blobs ? blobs[saveIndex] : undefined, indices ? indices[saveIndex] : undefined, function(err, docId){
						if (err){
							cb(err);
							return;
						}
						docIDs.push(docId);
						next();
					}, overwrite, ttl ? ttl[saveIndex] : undefined, !isLast); //Write index only when the last doc is inserted
				}

				function next(){
					saveIndex++;
					if (saveIndex == dataLength - 1) isLast = true;
					if (saveIndex == dataLength) cb(undefined, docIDs);
					else {
						if (saveIndex % 100 == 0) setTimeout(saveOne, 0);
						else saveOne();
					}
				}

				saveOne();
			};

			this.update = function(q, newData, callback, indexOnly){
				if (typeof callback != 'function') throw new TypeError('callback must be a function');
				if (!(typeof q == 'object' || typeof q == 'string')){
					callback(new Error('query must either be a string (docId) or an object (compound query)'));
					return;
				}
				if (!newData){
					callback(new Error('newData must be defined'));
					return;
				}
				if (!(typeof newData == 'string' || newData instanceof Uint8Array || (typeof newData == 'object' && Object.keys(newData).length > 0))){
					callback(new Error('newData must either be a string, or a buffer, or a standard object'));
					return;
				}
				if (indexOnly && !(typeof newData == 'object' && Object.keys(newData).length > 0)){
					callback(new Error('when indexOnly is on, newData must be a standard object'));
					return;
				}

				var matchedDocs = applyQuery(q, documentsIndex.documents);

				if (matchedDocs.length == 0){ //No docs to be updated
					callback(undefined, 0);
					return;
				}

				var indexModel = documentsIndex.indexModel;
				var docIndex = 0;

				processOne();

				function processOne(){
					var currentDoc = matchedDocs[docIndex];
					var docId = currentDoc.id;
					var indexData = currentDoc.index;
					if (typeof newData == 'string'){
						saveDoc(docId, newData, indexData, 'string', currentDoc.ttl, next);
					} else if (newData instanceof Uint8Array){
						saveDoc(docId, newData, indexData, 'buffer', currentDoc.ttl, next);
					} else { //JSON object
						var blobData;

						if (currentDoc.k && currentDoc.blobType){ //If there is a blob
							//Read it. Regardless of it's type, you'll need it later
							readDoc(currentDoc, function(err, blobResult){
								if (err){
									next(err);
									return;
								}

								if (!indexOnly){
									if (currentDoc.blobType == 'json'){ //The blob is JSON
										//read the blob, update upon it, then save
										var newDataAttributes = Object.keys(newData);
										for (var i = 0; i < newDataAttributes.length; i++){
											blobResult[newDataAttributes[i]] = newData[newDataAttributes[i]];
										}
										blobData = JSON.stringify(blobResult);
									} else { //The current blob is not JSON
										blobData = newData;
										//save the doc, overwriting blob
									}
								}
								updateIndex();
							});
						} else updateIndex(); //Saving the doc, adding the blob

						function updateIndex(){
							var newDataAttributes = Object.keys(newData);
							var newIndexData = clone(indexData);
							for (var i = 0; i < newDataAttributes.length; i++){
								newIndexData[newDataAttributes[i]] = newData[newDataAttributes[i]];
							}

							//If there is a model, validate against it
							if (indexModel){
								var validatedIndexData = validateIndexAgainstModel(newIndexData, indexModel);
								if (typeof validatedIndexData == 'string' || !validatedIndexData){
									next('INVALID_INDEX_DATA');
									return;
								}
								newIndexData = validatedIndexData;

								//Extracted supposed id and unique fields
								var indexFields = Object.keys(indexModel);
								var idField = null, uniqueFields = [];
								for (var i = 0; i < indexFields.length; i++){
									if (indexModel[indexFields[i]].id){
										if (!idField) idField = indexFields[i];
									}
									if (indexModel[indexFields[i]].unique){
										uniqueFields.push(indexFields[i]);
									}
								}

								//Check that the id didn't change with the new data
								if (idField && newIndexData[idField] != indexData[idField]){
									next('ID_CHANGE_FORBIDDEN');
									return;
								}

								for (var i = 0; i < uniqueFields.length; i++){
									if (!checkFieldIsUnique(uniqueFields[i], newIndexData[uniqueFields[i]])){
										next('DUPLICATE_UNIQUE_VALUE');
										return;
									}
								}
							}
							saveDoc(docId, blobData, newIndexData, 'json', currentDoc.ttl, next);
						}
					}
				}

				function next(err){
					if (err){
						callback(err, docIndex);
						return;
					}
					docIndex++;
					if (docIndex == matchedDocs.length){
						callback(undefined, matchedDocs.length);
					} else {
						if (docIndex % 100 == 0) setTimeout(processOne, 0);
						else processOne();
					}
				}
			};

			this.find = function(q, cb, limit){
				if (typeof cb != 'function') throw new TypeError('callback must be a function');
				if (!(typeof q == 'object' || typeof q == 'string')){
					cb(new Error('query must either be a string (docId) or an object (compound query)'));
					return;
				}
				if (!(typeof limit == 'undefined' || limit == null) && !(typeof limit == 'number' && limit == Math.floor(limit) && limit > 0)){
					cb(new Error('when defined, limit must be a strictly integer number'));
					return;
				}
				//If not blob, just return index data
				var results = applyQuery(q, documentsIndex.documents, limit);
				//No results found. Return an empty array right away.
				if (results.length == 0){
					cb(undefined, []);
					return;
				}

				var resultData = new Array(results.length);
				var endCount = 0;
				var _err;
				var cbCalled = false;

				for (var i = 0; i < results.length; i++){
					processResult(results[i], i);
				}

				//Trying to batch async calls. Is this going to be a bottleneck when scaling result set size
				function processResult(r, i){
					readDoc(r, function(err, doc){
						if (err){
							_err = err;
							return;
						}
						resultData[i] = doc;
						end();
					});
				}

				function end(){
					endCount++;

					if (cbCalled) return; //Really weird race condition cases

					if (endCount == results.length){
						if (_err) cb(err);
						else cb(undefined, resultData);
						cbCalled = true;
					}
				}
			};

			this.findOne = function(q, cb){
				if (typeof cb != 'function') throw new TypeError('cb must be a function');
				self.find(q, function(err, resultArray){
					if (err){
						cb(err);
						return;
					}
					if (!resultArray || resultArray.length == 0) cb();
					else cb(undefined, resultArray[0]);
				}, 1);
			};

			this.remove = function(q, cb, limit){
				if (typeof cb != 'function') throw new TypeError('callback must be a function');
				if (!(typeof q == 'string' || typeof q == 'object')) cb(new TypeError('query must either be a string (docId) or an object (compound query)'));

				if (!(typeof limit == 'undefined' || limit == null) && !(typeof limit == 'number' && Math.floor(limit) == limit && limit > 0)) cb(new TypeError('when defined, limit must be a strictly positive integer'));

				var results = applyQuery(q, documentsIndex.documents, limit);

				if (results.length == 0){
					cb(undefined, 0);
					return;
				}

				//Sync-like deletion
				var docIndex = 0;

				function removeOne(){
					removeDoc(results[docIndex].id, function(err){
						if (err){
							cb(err, docIndex); //Return the number of deleted docs until now
							return;
						}
						docIndex++;
						if (docIndex == results.length) cb(undefined, results.length);
						else {
							if (docIndex % 100 == 0) setTimeout(removeOne, 0); //Limit call stack size
							else removeOne();
						}
					});
				}

				removeOne();
			};

			this.count = function(q){
				if (q){
					if (typeof q == 'string') return documentsIndex.documents[q] ? 1 : 0;
					if (typeof q != 'object') throw new TypeError('when defined, q must either be a string or an object');
					var results = applyQuery(q, documentsIndex.documents);
					return results.length;
				} else return documentsIndex.docCount;
			};

			this.size = function(cb){
				if (cb && typeof cb != 'function') throw new TypeError('when defined, callback must be a function');

				var currentCollectionSize = collectionIndexSize + documentsIndex.collectionSize;
				if (cb) cb(undefined, currentCollectionSize);
				else return currentCollectionSize;
			};

			this.getTTL = function(q, cb){
				if (!(typeof q == 'string' || typeof q == 'object')) throw new TypeError('q must either be a string or an object');
				if (cb && typeof cb != 'function') throw new TypeError('cb must be a function');

				var results = applyQuery(q, documentsIndex.documents);

				if (results.length == 0){ //If no matched documents, just pass the empty array "to prove it"
					if (cb) cb(results);
					else return results;
				}

				var ttlResults = {};
				for (var i = 0; i < results.length; i++){
					ttlResults[results[i].id] = results[i].ttl;
				}

				if (cb) cb(ttlResults);
				else return ttlResults;
			};

			this.setTTL = function(q, ttl, cb){
				if (!(typeof q == 'string' || typeof q == 'object')) throw new TypeError('q must either be a string or an object');
				if (!(ttl == null || typeof ttl == 'undefined' || typeof ttl == 'number' || ttl instanceof Date)) throw new TypeError('ttl must either be null/undefined or a number or a Date instance');
				if (typeof ttl == 'number' && !(Math.floor(ttl) == ttl)) throw new TypeError('when ttl is a number, it must be an integer');
				if (ttl instanceof Date) ttl = ttl.getTime();
				if (typeof cb != 'function') throw new TypeError('cb must be a function');

				var ttlDocs = applyQuery(q, documentsIndex.documents);

				if (ttlDocs.length == 0){ //No docs mathed by the query, so no TTL to set/update
					cb();
					return;
				}

				if (ttl > 0 && ttl < Date.now()) ttl = ttl + Date.now();

				for (var i = 0; i < ttlDocs.length; i++){
					if (ttl <= 0 || ttl == null || typeof ttl == 'undefined'){
						if (ttlDocs[i].ttl) delete ttlDocs[i].ttl; //Delete ttl value
					} else ttlDocs[i].ttl = ttl; //Setting/updating ttl value

					var currentDocId = ttlDocs[i].id;
					documentsIndex.documents[currentDocId] = ttlDocs[i]; //Set the resulting modified doc in documentsIndex
					delete documentsIndex.documents[currentDocId].id; //Removing the injected identifier
					serializedIndex.documents[currentDocId] = documentsIndex.documents[currentDocId]; //Replacing the corresponding document in serializedIndex by the resulting object
					serializedIndex.documents[currentDocId].index = serializeObject(serializedIndex.documents[currentDocId].index); //Re-serializing the resulting object
				}

				//Save the resulting collection index to persistent memory
				saveDocumentsIndex(cb);
			};

			this.close = function(){
				if (purgeInterval){
					clearInterval(purgeInterval);
					purgeInterval = null;
				}
				k = null;
				documentsIndex.documents = null;
			};

			function saveDocumentsIndex(cb){
				if (typeof cb != 'function') throw new TypeError('callback must be a function');

				//if (!k) k = sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, rootKey, from_hex(collectionDescription.salt));
				if (!k) k = from_hex(collectionDescription.key);

				var docsIndexStr = JSON.stringify(serializedIndex);
				var nonceBuffer = randomBuffer(sodium.crypto_secretbox_NONCEBYTES);
				var docsIndexCipher = sodium.crypto_secretbox_easy(docsIndexStr, nonceBuffer, k);
				var docsIndexFile = concatBuffers([nonceBuffer, docsIndexCipher]);
				collectionIndexSize = docsIndexFile.length;
				//var docsIndexFileStr = to_base64(docsIndexFile, true);
				fs.writeFile(indexFilePath, docsIndexFile, cb);
			}

			function applyQuery(query, dataset, limit, matchFunction, includePureBlobs){
				if (limit && !(typeof limit == 'number' && limit == Math.floor(limit) && limit > 0)) throw new TypeError('When provided, limit must be a strictly positive integer number');
				if (matchFunction && typeof matchFunction != 'function') throw new TypeError('when provided, matchFunction must be a function');
				//Even though reducing the dataset by removing the non-corresponding results using the `slice` function is more elegant, it isn't the most memory efficient

				//Transform the dataset into an array?

				if (!Array.isArray(dataset)){
					var datasetArray = [];
					var datasetKeys = Object.keys(dataset);
					for (var i = 0; i < datasetKeys.length; i++){
						var docCopy = clone(dataset[datasetKeys[i]]); //Cloning doc object, before adding id prop to it
						docCopy.id = datasetKeys[i];
						datasetArray.push(docCopy);
					}
					dataset = datasetArray;
				}

				//From here, dataset is forcibly an array

				var queryResults = [];
				var queryType = typeof query;
				if (queryType == 'string'){
					var matchFn = matchFunction || defaultMatchFunction;
					//If only a string is provided, we are looking for a doc that has this string as id?
					for (var i = 0; i < dataset.length; i++){
						if (matchFn(dataset[i].id, query)){
							queryResults.push(dataset[i]);
							if (limit && queryResults.length == limit) return sortAndReturn();
						}
					}
					return sortAndReturn();
				}

				var withSorting = false;
				var skipDocs;
				if (query['$sort']){
					if (typeof query['$sort'] != 'object') throw new TypeError('invalid $sort operator. It must be an object');
					if (Object.keys(query['$sort']).length != 1) throw new TypeError('invalid $sort operator. It must have exactly one attribute');
					var sortingField = Object.keys(query['$sort'])[0]
					var sortingValue = query['$sort'][sortingField];
					if (typeof sortingValue == 'string'){
						sortingValue = sortingValue.toLowerCase();
						if (sortingValue == 'desc') sortingValue = -1;
						else if (sortingValue == 'asc') sortingValue = 1;
					}
					if (!(sortingValue == 1 || sortingValue == -1)){
						throw new TypeError('invalid $sort order');
					}
					query['$sort'][sortingField] = sortingValue;
					withSorting = true;
				}

				if (query['$skip']){
					skipDocs = query['$skip'];
					if (!(typeof skipDocs == 'number' && skipDocs >= 0 && Math.floor(skipDocs) == skipDocs)) throw new TypeError('invalid $skip operator. It must be a positive integer number');
				}

				if (query['$match']){
					if (typeof query['$match'] != 'function') throw new TypeError('invalid $match operand. it must be a function');
					matchFunction = query['$match'];
				}

				//Detect $or keyword
				if (query['$or']){
					var orQuery = query['$or'];
					if (!(Array.isArray(orQuery) && orQuery.length > 0)){
						throw new Error('invalid $or operand: ' + JSON.stringify(query));
					}

					//This is disturbingly inefficient
					var partialResults = [];
					for (var i = 0; i < orQuery.length; i++){
						//Querying the dataset with one of the $or operand's parameters
						var currentPartialResult = applyQuery(orQuery[i], dataset, limit, matchFunction);

						//No partial result found
						if (currentPartialResult.length == 0) continue;
						partialResults.push(currentPartialResult);
					}

					//Merge partial results into one dataset and return it
					queryResults = unionResults(partialResults, limit);
					return sortAndReturn();
				}
				//Detect $not keyword
				if (query['$not']){
					var notQuery = query['$not'];
					if (!(typeof notQuery == 'string' || typeof notQuery == 'object')) throw new Error('invalid $not operand: ' + JSON.stringify(query));

					var matchFn = matchFunction || defaultMatchFunction
					if (typeof notQuery == 'string'){
						var matchingSubset = applyQuery(notQuery, dataset, limit, negate(matchFn));
						queryResults = matchingSubset;
						return sortAndReturn();
					}
					//Query is an object
					var results = applyQuery(notQuery, dataset, limit, negate(matchFn), true);
					queryResults = results;
					return sortAndReturn();
				}
				//Last case, standard "and" operation
				var matchFn = matchFunction || defaultMatchFunction;

				//console.log('Dataset to search through: ' + JSON.stringify(dataset));

				var queryAttributes = Object.keys(query);

				if (queryAttributes.length == 0){ //If there are no query components, match all the dataset, with the limit if one is imposed, if there is no sorting (otherwise it will be done after sorting, in sortAndReturn())
					if (limit && !withSorting) for (var i = 0; i < limit && i < dataset.length; i++) queryResults.push(dataset[i]);
					else queryResults = dataset;
					return sortAndReturn();
				}

				for (var i = 0; i < dataset.length; i++){
					if (!dataset[i].index){
						if (includePureBlobs){
							queryResults.push(dataset[i]);
						}
						continue; //No index data to search in
					}

					var matchedAttributes = 0;
					for (var j = 0; j < queryAttributes.length; j++){
						//Exclude the attribute that equals with $match. Note that not all docs have index data
						if (matchFn(dataset[i].index[queryAttributes[j]], query[queryAttributes[j]]) || queryAttributes[j] == '$sort' || queryAttributes[j] == '$skip'){ //Ignoring the $sort & $skip attribute of the query, if any
							matchedAttributes++;

							if (matchedAttributes == queryAttributes.length){
								queryResults.push(dataset[i]);
								if (limit && queryResults.length == limit && !withSorting) return sortAndReturn();
								break;
							}
						} else break; //If one of the query attributes is not matched, go to next document
					}
				}

				return sortAndReturn();

				function sortAndReturn(){
					if (query['$sort']){
						var sortingField = Object.keys(query['$sort'])[0];
						var sortingOrder = query['$sort'][sortingField];
						queryResults.sort(function(a, b){
							var aValue = a.index[sortingField], bValue = b.index[sortingField];
							if (aValue instanceof Date) aValue = aValue.getTime(); //Converting dates to numbers to ensure proper date sorting
							if (bValue instanceof Date) bValue = bValue.getTime();
							if (aValue == bValue || typeof aValue != typeof bValue) return 0; //No indication of order if equal values or values of different types
							if (sortingOrder == 1) return aValue < bValue ? -1 : 1;
							else return aValue > bValue ? -1 : 1;
						});
					}
					if (skipDocs){
						var retainedResults = [];
						for (var i = skipDocs; i < queryResults.length; i++) retainedResults.push(queryResults[i]);
						queryResults = retainedResults;
					}
					if (limit && queryResults.length > limit){
						var limitedResults = [];
						for (var i = 0; i < limit; i++) limitedResults.push(queryResults[i]);
						queryResults = limitedResults;
					}
					return queryResults;
				}

				function unionResults(partials, limit){
					var mergedResults = [];
					for (var i = 0; i < partials.length; i++){
						for (var j = 0; j < partials[i].length; j++)
						if (!isPartOfDataset(mergedResults, partials[i][j].id)){
							mergedResults.push(partials[i][j]);
							//Checking that we didn't reach the limit
							if (limit && mergedResults.length == limit) return mergedResults;
						}
					}
					return mergedResults;
				}

				//In case I want to have `$and` operators with `$match` functions, I may need that...
				function intersectResults(partials, limit){

				}

				function isPartOfDataset(ds, id){
					for (var i = 0; i < ds.length; i++) if (ds[i].id == id) return true;
					return false;
				}

				function defaultMatchFunction(a, b){
					return a == b;
				}

				function notMatchFunction(a, b){
					return a != b;
				}

				function negate(fn){
					return function(a, b){
						return !fn(a, b);
					}
				}
			}

			function removeDoc(id, cb, doNotSaveIndex){
				if (!documentsIndex.documents[id]){
					cb();
					return;
				}

				if (!documentsIndex.documents[id].k){
					//Docs that have a blob also have a k attribute, that holds the encryption key. If no k attribute can be found, then there is no blob association to the doc
					removeFromIndex();
				} else {
					//Discounting the collection size from the blob to be deleted
					var docFilePath = pathJoin([rootPath, collectionName, id]);
					documentsIndex.collectionSize -= documentsIndex.documents[id].size;
					serializedIndex.collectionSize = documentsIndex.collectionSize;

					fs.unlink(docFilePath, function(err){
						if (err) cb(err);
						else removeFromIndex();
					});
				}

				function removeFromIndex(){
					delete documentsIndex.documents[id];
					delete serializedIndex.documents[id];

					documentsIndex.docCount--;
					serializedIndex.docCount = documentsIndex.docCount;
					if (doNotSaveIndex) cb();
					else saveDocumentsIndex(cb);
				}
			}

			function saveDoc(docId, fileData, indexData, blobType, ttl, cb, overwrite, doNotWriteIndex){
				var docIndexObj;
				saveIndex(function(err){
					if (err) cb(err);
					else saveBlob(cb);
				});

				function saveBlob(_cb){
					if (!fileData){
						_cb(undefined, docId);
						return;
					}
					var docFilePath = pathJoin([rootPath, collectionName, docId]);

					var docKey = randomBuffer(sodium.crypto_secretbox_KEYBYTES);
					var docNonce = randomBuffer(sodium.crypto_secretbox_NONCEBYTES);

					var dataBuffer;
					if (fileData instanceof Uint8Array) dataBuffer = fileData;
					else dataBuffer = from_string(fileData);
					//console.log('Encrypting blob');
					var encryptedFileData = sodium.crypto_secretbox_easy(dataBuffer, docNonce, docKey);
					//var finalFileData = to_base64(concatBuffers([docNonce, encryptedFileData]), true);
					var finalFileData = concatBuffers([docNonce, encryptedFileData]);
					//console.log('Blob encrypted');
					docIndexObj.k = to_base64(docKey, true);
					serializedDocIndexObj.k = docIndexObj.k;
					//Updating DB size calculation
					docIndexObj.size = finalFileData.length;
					serializedDocIndexObj.size = docIndexObj.size;

					documentsIndex.collectionSize += finalFileData.length;
					serializedIndex.collectionSize = documentsIndex.collectionSize;
					//console.log('Saving encryption key');
					if (doNotWriteIndex){
						writeBlob();
					} else {
						saveDocumentsIndex(function(err){
							if (err){
								_cb(err);
								return;
							}
							writeBlob();
						});
					}

					/*saveDocumentsIndex(function(err){
						if (err){
							_cb(err);
							return;
						}
						//console.log('Rewriting index');
						fs.unlink(docFilePath, function(err){ //Deleting the blob file, if there is one. Basically, ensuring an overwrite
							if (err){
								_cb(err);
								return;
							}
							fs.writeFile(docFilePath, finalFileData, function(err){
								if (err) _cb(err);
								else {
									_cb(undefined, docId);
								}
							});
						});
					});*/

					function writeBlob(){
						fs.unlink(docFilePath, function(err){ //Deleting the blob file, if there is one. Basically, ensuring an overwrite
							if (err){
								_cb(err);
								return;
							}
							fs.writeFile(docFilePath, finalFileData, function(err){
								if (err) _cb(err);
								else {
									_cb(undefined, docId);
								}
							});
						});
					}
				}

				function saveIndex(_cb){
					//If a docId is provided, use it (it may overwrite an existing doc, but we've checked that before). Otherwise, generate one

					if (!docId){
						//Generating doc IDs until we get a unique one. Note that if the docId has been provided by the user, it has been checked for unicity earlier
						do {
							docId = docId || to_hex(randomBuffer(8));
						} while (!checkIdIsUnique(docId));
					}

					var updateOrOverwrite = false;
					if (documentsIndex.documents[docId]){
						/*	At this point, if there is already a document with that Id in the index,
							we are overwriting it. Meaning also that we must not increment the docCount
						*/
						updateOrOverwrite = true;
					}

					var ttlData;
					if (ttl){
						if (ttl < Date.now()) ttlData = ttl + Date.now();
						else ttlData = ttl;
					}

					docIndexObj = {
						index: indexData,
						blobType: blobType,
						ttl: ttlData
					};

					if (!updateOrOverwrite){
						documentsIndex.docCount++;
						serializedIndex.docCount++;
					}

					documentsIndex.documents[docId] = docIndexObj;

					serializedDocIndexObj = {blobType: blobType, ttl: ttlData};
					serializedDocIndexObj.index = serializeObject(docIndexObj.index);
					serializedIndex.documents[docId] = serializedDocIndexObj;

					//console.log('Saving index data');
					if (doNotWriteIndex){
						_cb(undefined, docId);
						return;
					}
					saveDocumentsIndex(function(err){
						_cb(err, docId);
					});
				}
			}

			function readDoc(idOrDoc, cb){
				var doc;
				var docId;

				if (typeof idOrDoc == 'string'){
					doc = documentsIndex.documents[idOrDoc];
					docId = idOrDoc;
				} else if (typeof idOrDoc == 'object'){
					doc = idOrDoc;
					docId = doc.id;
				} else {
					throw new TypeError('Invalid idOrDoc reference type: ' + typeof idOrDoc);
				}

				if (doc.k){
					var docFilePath = pathJoin([rootPath, collectionName, docId]);
					fs.exists(docFilePath, function(blobExists){
						if (!blobExists){
							cb('Encrypted blob cannot be found');
							return;
						}
						fs.readFile(docFilePath, function(err, data){
							if (err){
								cb(err);
								return;
							}
							//var fileDataBuffer = from_base64(data);
							var fileDataBuffer = data;
							if (fileDataBuffer.length < minFileSize){
								cb('INVALID_BLOB');
								return;
							}

							var nonceBuffer = new Uint8Array(sodium.crypto_secretbox_NONCEBYTES);
							for (var i = 0; i < nonceBuffer.length; i++){
								nonceBuffer[i] = fileDataBuffer[i];
							}
							var cipherBuffer = new Uint8Array(fileDataBuffer.length - nonceBuffer.length);
							for (var i = 0; i < cipherBuffer.length; i++){
								cipherBuffer[i] = fileDataBuffer[ i + sodium.crypto_secretbox_NONCEBYTES ];
							}

							var decryptedBlob = sodium.crypto_secretbox_open_easy(cipherBuffer, nonceBuffer, from_base64(doc.k));
							if (!decryptedBlob){
								cb('CORRUPTED_BLOB');
								return;
							}

							//Reconvert the blob to its original format
							var bType = doc.blobType;
							var result;
							if (bType == 'buffer'){
								result = decryptedBlob;
							} else if (bType == 'json'){
								var resultStr = to_string(decryptedBlob);
								try {
									result = JSON.parse(resultStr);
								} catch (e){
									cb(new Error('Invalid JSON'));
									return;
								}

								result = deserializeObject(result);
							} else if (bType == 'string'){
								var resultStr = to_string(decryptedBlob);
								result = resultStr;
							} else {
								callback(new Error('Invalid blob type: ' + bType));
								//What?
							}
							cb(undefined, result);
						}, true);
					});
				} else cb(undefined, clone(doc.index));
			}

			function ttlCheckAndPurge(cb){
				if (cb && typeof cb != 'function') throw new TypeError('when defined, cb must be a function');

				if (purgeOngoing) return;
				var purgeOngoing = true;
				var n = Date.now();

				var docsToDelete;

				var docsList = Object.keys(documentsIndex.documents);
				for (var i = 0; i < docsList.length; i++){
					var ttlVal = documentsIndex.documents[docsList[i]].ttl;
					if (ttlVal && ttlVal <= n){
						if (!docsToDelete) docsToDelete = [docsList[i]];
						else docsToDelete.push(docsList[i]);
					}
				}

				if (docsToDelete && docsToDelete.length > 0) console.log('Expired docs from collection ' + collectionName + ': ' + JSON.stringify(docsToDelete));

				var docIndex = 0;

				function deleteOne(){
					var currentDocId = docsToDelete[docIndex];
					removeDoc(currentDocId, function(err){
						if (err){
							if (cb) cb(err);
							else console.error('Error while trying to delete the expired doc ' + currentDocId + ' from collection ' + collectionName + ': ' + err);
							return;
						}
						docIndex++;
						if (docIndex == docsToDelete.length){
							saveDocumentsIndex(function(err){
								if (err){
									console.error('Error while saving doc index for deleting expired docs: ' + err);
								}
								purgeOngoing = false;
								if (cb) cb();
								return;
							});
						} else {
							//Chain doc deletions
							if (docIndex % 100 == 0) setTimeout(deleteOne, 0);
							else deleteOne();
						}
					}, true); //Do not save doc index after deleting one doc, but rather after deleting all expired docs
				}

				if (docsToDelete) deleteOne();
				else {
					purgeOngoing = false;
					if (cb) cb();
				}
			}

			function checkIdIsUnique(id, cb){
				if (!documentsIndex.documents[id]){
					if (cb) cb(true);
					return true;
				}
				if (cb) cb(false);
				return false;
			}

			function checkFieldIsUnique(fieldName, value, cb){
				var docsList = Object.keys(documentsIndex.documents);
				for (var i = 0; i < docsList.length; i++){
					if (documentsIndex.documents[docsList[i]].index[fieldName] == value){
						if (cb) cb(false);
						return false;
					}
				}
				if (cb) cb(true);
				return true;
			}

		}

		function concatBuffers(buffers){
			if (!Array.isArray(buffers)) return;

			//I do not want to do it recursively, because I guess it would be much heavier memory-wise

			var totalSize = 0;
			for (var i = 0; i < buffers.length; i++){
				if (!(buffers[i] instanceof Uint8Array)) return;
				totalSize += buffers[i].length;
			}
			var baseIndex = 0;
			var b = new Uint8Array(totalSize);
			for (var i = 0; i < buffers.length; i++){
				for (var j = 0; j < buffers[i].length; j++){
					b[baseIndex + j] = buffers[i][j];
				}
				baseIndex += buffers[i].length;
			}
			return b;
		}

		/*
		* Collection index model validation
		*/

		function isType(t){for (var i = 0; i < permittedIndexTypes.length; i++){if (permittedIndexTypes[i] == t) return true;} return false;}
		function isFieldName(n){return /^[\w\-\.]+$/.test(n);}

		//Returns validated model object, or the name of a failing field
		function validateIndexModel(model){
			// {name, type, unique, id}
			var fieldNames = Object.keys(model);
			var idField;
			for (var i = 0; i < fieldNames.length; i++){
				var fieldName = fieldNames[i];

				if (!isFieldName(fieldName)) return fieldName;

				var fieldDescription = model[fieldName];

				if (typeof fieldDescription == 'string'){
					fieldDescription = {type: fieldDescription};
				} else if (typeof fieldDescription == 'object' && Object.keys(fieldDescription).length > 0){
					//Removing unwanted attributes. Keep what we want
					fieldDescription = {type: fieldDescription.type, id: fieldDescription.id, unique: fieldDescription.unique};
				} else {
					//Invalid field description
					return fieldName;
				}

				if (!isType(fieldDescription.type)) return fieldName;

				if (fieldDescription.id){
					if (idField) return fieldName; //An ID field already exists
					else idField = fieldName;
				}

				//Field description can now be considered as valid. Push it somewhere
				model[fieldName] = fieldDescription;
			}
		}

		/*
		* Returns either an object containing the validated data, or a string containing the name of the field that failed type validation
		* NOTE : It doesn't check id and/or field unicity
		*/
		function validateIndexAgainstModel(indexData, model){
			//Assumption : `model` is a valid model
			if (typeof indexData != 'object') throw new TypeError('indexData must be an object');
			if (typeof model != 'object') throw new TypeError('model must be an object');

			var validatedData = {};

			var indexDataKeys = Object.keys(indexData);
			for (var i = 0; i < indexDataKeys.length; i++){
				if (!model[indexDataKeys[i]]) continue; //Skip fields that aren't in the model

				var currentFieldName = indexDataKeys[i];
				var currentFieldData = indexData[currentFieldName];

				var currentFieldDescription = model[currentFieldName];

				//If all data types are allowed for this field, then just add the current value to validatedData & continue (process next field, if any)
				if (currentFieldDescription.type == '*'){
					validatedData[currentFieldName] = currentFieldData;
					continue;
				}

				var currentDataType;
				var to = typeof currentFieldData;

				if (to == 'object'){
					if (!currentFieldData){
						//Field is `null`
						continue;
					} else if (Array.isArray(currentFieldData)){
						currentDataType = 'array'
					} else if (currentFieldData instanceof Date){
						currentDataType = 'date'
					} else {
						currentDataType = 'object' //Standard object
					}
				} else if (to == 'string' || to == 'boolean' || to == 'number') currentDataType = to;
				else return currentFieldName; //Is not a valid type. type function is a known case; is there an other?

				if (currentFieldDescription.type == currentDataType){
					validatedData[currentFieldName] = currentFieldData;
				} else {
					return currentFieldName; //Is not THE valid type
				}

			}

			return validatedData;
		}

	};

	/**
	* Join file path parts
	* @private
	* @param {String|Array<String>} part1 - a path part, or an array of parts
	* @param {String} part2 - the second part of the path. Can also be used if part1 is an array of strings
	* @returns {String} - the constructed file path
	*/
	function _pathJoin(part1, part2){
		if (Array.isArray(part1)){
			if (part1.length == 0) return;

			var totalPath = part1[0];
			for (var i = 1; i < part1.length; i++){
				totalPath = pathJoin(totalPath, part1[i]);
				if (!totalPath) return; //If one the parts were invalid, silently stop concating the parts and return
			}
			if (part2 && typeof part2 == 'string') totalPath = pathJoin(totalPath, part2); //If part2 is defined and is a string, concat. Otherwise, ignore.
			return totalPath;
		}

		if (!(typeof part1 == 'string' && typeof part2 == 'string')) return; //If one of the parts is not a string, return

		if (part1.lastIndexOf('/') != part1.length - 1){
			part1 += '/';
		}
		return part1 + part2;
	};

	/*
	* Deep clone of an object. WARNING: NOT CHECKING FOR CIRCULAR REFERENCES
	*/
	function clone(o){
		var typeO = typeof o;
		if (typeO == 'object'){
			if (Array.isArray(o)){
				var c = [];
				for (var i = 0; i < o.length; i++) c.push(clone(o[i]));
				return c;
			} else if (o instanceof Date){
				return new Date(o.getTime());
			} else if (o == null){
				return null;
			} else {
				var props = Object.keys(o);
				var c = {};
				for (var i = 0; i < props.length; i++) c[props[i]] = clone(o[props[i]])
				return c;
			}
		} else if (typeO == 'number' || typeO == 'string' || typeO == 'boolean') return o;
	}
	exports.clone = clone;

	/*
	* Deep object equality
	*/
	function deepObjectEquality(o1, o2){
		if (!(typeof o1 == typeof o2)) return false;
		var paramType = typeof o1;
		if (paramType == 'object'){
			if (Array.isArray(o1) || Array.isArray(o2)){
				if (xor(Array.isArray(o1), Array.isArray(o2))) return false;
				//We assume that both parameters are arrays
				if (o1.length != o2.length) return false;
				for (var i = 0; i < o1.length; i++){
					if (!deepObjectEquality(o1[i], o2[i])) return false;
				}
				return true;
			} else if (o1 instanceof Date || o2 instanceof Date){
				if (xor(o1 instanceof Date, o2 instanceof Date)) return false;
				return o1.getTime() == o2.getTime();
			}

			var o1Keys = Object.keys(o1);
			var o2Keys = Object.keys(o2);
			if (o1Keys.length != o2Keys.length) return false;

			var commonPropertiesNames = 0;
			for (var i = 0; i < o1Keys.length; i++){
				for (var j = 0; j < o2Keys.length; j++){
					if (o1Keys[i] == o2Keys[j]){
						commonPropertiesNames++;
						break;
					}
				}
			}

			if (commonPropertiesNames < o1Keys.length) return false;

			for (var i = 0; i < o1Keys.length; i++){
				if (!deepObjectEquality(o1[o1Keys[i]], o2[o1Keys[i]])) return false;
			}
			return true;
		} else if (paramType == 'function'){
			throw new TypeError('Cannot check equality for functions');
		} else return o1 == o2;
	}
	exports.deepObjectEquality = deepObjectEquality;

	// Logical XOR
	function xor(a, b){
		return (a && !b) || (!a && b);
	}

	/***********************************************************
	*
	* Scrypt file encryption and decryption methods
	*
	***********************************************************/

	/* Encrypted buffer format. Numbers are in big endian
	* 2 bytes : r (unsigned short)
	* 2 bytes : p (unsigned short)
	* 4 bytes : opsLimit (unsigned long)
	* 2 bytes: salt size (sn, unsigned short)
	* 2 bytes : nonce size (ss, unsigned short)
	* 4 bytes : key buffer size (x, unsigned long)
	* sn bytes: salt
	* ss bytes : nonce
	* x bytes : encrypted data buffer (with MAC appended to it)
	*/

	function scryptFileEncode(buffer, rootKey, salt, opsLimit, r, p){
		if (!(buffer && buffer instanceof Uint8Array)) throw new TypeError('Buffer must be a Uint8Array');
		if (!(typeof rootKey == 'string' || rootKey instanceof Uint8Array)) throw new TypeError('rootKey must be a string or a Uint8Array buffer');
		if (!(typeof salt == 'string' || salt instanceof Uint8Array)) throw new TypeError('salt must be a string or a Uint8Array buffer');

		if (rootKey.length != sodium.crypto_secretbox_KEYBYTES) throw new TypeError('rootKey must be 32 bytes long');

		//Default Scrypt parameters
		opsLimit = opsLimit || 16384;
		r = r || 8;
		p = p || 1;

		if (!(typeof opsLimit == 'number' && Math.floor(opsLimit) == opsLimit && opsLimit > 0)) throw new TypeError('when defined, opsLimit must be a strictly positive integer number');
		if (!(typeof r == 'number' && Math.floor(r) == r && r > 0)) throw new TypeError('when defined, r must be a strictly positive integer number');
		if (!(typeof p == 'number' && Math.floor(p) == p && p > 0)) throw new TypeError('when defined, p must be a strictly positive integer number');

		var saltSize = salt.length;
		var nonceSize = sodium.crypto_secretbox_NONCEBYTES;
		var totalSize = 16 + saltSize + nonceSize + buffer.length + sodium.crypto_secretbox_MACBYTES;

		var b = new Uint8Array(totalSize);
		var bIndex = 0;

		//Writing r and p
		b[bIndex] = (r >> 8);
		b[bIndex+1] = r;
		bIndex += 2;
		b[bIndex] = (p >> 8);
		b[bIndex+1] = p;
		bIndex += 2;
		//Writing opsLimit
		for (var i = 4; i > 0; i--){
			b[ bIndex ] = (opsLimit >> (8 * (i - 1))) % 256;
			bIndex++;
		}
		//Writing saltSize
		b[bIndex] = (saltSize >> 8);
		b[bIndex+1] = saltSize;
		bIndex += 2;
		//Writing nonceSize
		b[bIndex] = (nonceSize >> 8);
		b[bIndex+1] = nonceSize;
		bIndex += 2;
		//Writing encryptedbuffer size
		var encContentSize = buffer.length + sodium.crypto_secretbox_MACBYTES;
		b[bIndex] = (encContentSize >> 24);
		b[bIndex+1] = (encContentSize >> 16);
		b[bIndex+2] = (encContentSize >> 8);
		b[bIndex+3] = encContentSize;
		bIndex += 4;
		//Writing salt
		for (var i = 0; i < saltSize; i++){
			b[ bIndex + i ] = salt[i];
		}
		bIndex += saltSize;
		//Writing nonce
		var nonce = randomBuffer(nonceSize);
		for (var i = 0; i < nonceSize; i++){
			b[ bIndex + i ] = nonce[i];
		}
		bIndex += nonceSize;

		//Encrypt the content and write it
		var cipher = sodium.crypto_secretbox_easy(buffer, nonce, rootKey);
		for (var i = 0; i < cipher.length; i++){
			b[bIndex+i] = cipher[i];
		}
		bIndex += cipher.length;
		return b;
	}

	function scryptFileDecode(buffer, rootKey, headerData){
		if (!(buffer && buffer instanceof Uint8Array)) throw new TypeError('Buffer must be a Uint8Array');
		if (!(typeof rootKey == 'string' || rootKey instanceof Uint8Array)) throw new TypeError('rootKey must be a string or a Uint8Array buffer');

		headerData = headerData || scryptFileDecodeHeader(buffer);
		if (typeof headerData != 'object') throw new TypeError('headerData must be an object');

		//Decrypting the ciphertext
		//console.log('Ciphertext: ' + to_hex(cipherText));
		var plainText = sodium.crypto_secretbox_open_easy(headerData.cipher, headerData.nonce, rootKey);
		//console.log('Key plain text:' + to_hex(plainText));
		return plainText; //If returned result is undefined, then invalid rootKey (or corrupted buffer)
	}

	function scryptFileDecodeHeader(buffer){
		if (!(buffer && buffer instanceof Uint8Array)) throw new TypeError('buffer must be a Uint8Array buffer');

		var minRemainingSize = 16; //16 bytes from the above format description

		if (in_avail() < minRemainingSize) throw new RangeError('Invalid encrypted buffer format');

		var r = 0, p = 0, opsLimit = 0, saltSize = 0, nonceSize = 0, encBufferSize = 0;
		var opsLimitBeforeException = 4194304;
		var rIndex = 0;

		//Reading r
		r = (buffer[rIndex] << 8) + buffer[rIndex+1];
		rIndex += 2;
		minRemainingSize -= 2;

		//Reading p
		p = (buffer[rIndex] << 8) + buffer[rIndex+1];
		rIndex += 2;
		minRemainingSize -= 2;

		//Reading opsLimit
		for (var i = 3; i >= 0; i--){
			opsLimit += (buffer[rIndex] << (8*i));
			//console.log('opsLimitPart[' + (4 - i).toString() + ']:' + (buffer[rIndex] << (8*i)));
			rIndex++;
		}
		minRemainingSize -= 4;

		if (opsLimit > opsLimitBeforeException) throw new RangeError('opsLimit over the authorized limit of ' + opsLimitBeforeException + ' (limited for performance issues)');

		//Reading salt size
		saltSize = (buffer[rIndex] << 8) + buffer[rIndex+1];
		rIndex += 2;
		minRemainingSize -= 2;
		minRemainingSize += saltSize;

		//Reading nonce
		nonceSize = (buffer[rIndex] << 8) + buffer[rIndex+1];
		rIndex += 2;
		minRemainingSize -= 2;
		minRemainingSize += nonceSize;

		//console.log('r: ' + 8 + '\np: ' + p + '\nopsLimit: ' + opsLimit + '\nsaltSize: ' + saltSize + '\nnonceSize: ' + nonceSize);

		if (in_avail() < minRemainingSize) throw new RangeError('Invalid encrypted buffer format');

		if (nonceSize != sodium.crypto_secretbox_NONCEBYTES) throw new RangeError('Invalid nonce size');

		//Reading encrypted buffer length
		for (var i = 3; i >= 0; i--){
			encBufferSize += (buffer[rIndex] << (8*i));
			rIndex++;
		}
		minRemainingSize -= 4;
		minRemainingSize += encBufferSize;

		if (in_avail() < minRemainingSize) throw new RangeError('Invalid encrypted buffer format');

		//Reading salt
		var salt = new Uint8Array(saltSize);
		for (var i = 0; i < saltSize; i++){
			salt[i] = buffer[rIndex+i];
		}
		rIndex += saltSize;
		minRemainingSize -= saltSize;
		//console.log('Salt: ' + to_hex(salt));

		//Reading nonce
		var nonce = new Uint8Array(nonceSize);
		for (var i = 0; i < nonceSize; i++){
			nonce[i] = buffer[rIndex+i];
		}
		rIndex += nonceSize;
		minRemainingSize -= nonceSize;
		//console.log('Nonce: ' + to_hex(nonce));

		//Reading cipherText
		var cipherText = new Uint8Array(encBufferSize);
		for (var i = 0; i < encBufferSize; i++){
			cipherText[i] = buffer[rIndex+i];
		}
		rIndex += encBufferSize;
		minRemainingSize -= encBufferSize;

		return {r: r, p: p, N: opsLimit, salt: salt, nonce: nonce, cipher: cipherText};

		function in_avail(){return buffer.length - rIndex;}
	}

}));
