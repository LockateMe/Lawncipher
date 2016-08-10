/*
* Lawnchair-inspired libsodium-backed encrypted persistent document storage
*/
(function(root, factory){
	var _nodeContext = false;
	if (typeof process === 'object' && process != null){
		_nodeContext = true;
	}

	if (typeof define === 'function' && define.amd){
		define(['exports', 'sodium', 'console', _nodeContext.toString(), 'require', 'window', 'Long'], factory);
	} else if (typeof exports !== 'undefined'){
		factory(exports, require('libsodium-wrappers'), console, _nodeContext, require, !_nodeContext ? window : undefined, require('long'));
	} else {
		var cb = root.Lawncipher && root.Lawncipher.onload;
		factory((root.Lawncipher = {}), sodium, console, _nodeContext, typeof require != 'undefined' && require, !_nodeContext ? window : undefined, window.dcodeIO.Long);
		if (typeof cb == 'function'){
			cb(root.Lawncipher);
		}
	}

}(this, function(exports, sodium, console, nodeContext, require, window, Long){

	var fs; //FileSystem reference. Depends on context
	var pathJoin, rmdirr, mkdirp, fsExists; //Reference to "special case" fs methods, whose implementations are not always present/part of the fs library that we have. Populated in the if(nodeContext) below
	var randomBuffer; //Holds a reference to a function that generates a given number of pseudo random bytes. Implementation depends on context
	var checkWriteBuffer, checkReadBuffer; //Holds references to functions that we are writing and reading files with the right type of buffer (Uint8Array vs Buffer, depending on context, again)
	var scryptProv, scryptProvAsync;
	var cryptoProv, cryptoProvAsync;
	var MiniSodium;

	var initCalled = false;

	//Adding an init method when not running in Node or in one of its derivatives
	if (!nodeContext){
		/******************
		* NON-NODE CONTEXT
		*******************/
		pathJoin = _pathJoin;

		randomBuffer = function(size){
			if (!(typeof size == 'number' && size > 0 && Math.floor(size) == size)) throw new TypeError('size must be a strictly positive integer');
			var b = new Uint8Array(size);
			window.crypto.getRandomValues(b);
			return b;
		};

		checkReadBuffer = function(b){
			if (b instanceof Uint8Array) return b;
			else throw new TypeError('The the read buffer variable must be a Uint8Array instance');
		};

		checkWriteBuffer = function(b){
			if (b instanceof Uint8Array || typeof b == 'string') return b;
			else throw new TypeError('The buffer to be written must be a Uint8Array or a string')
		};
	} else {
		/******************
		* NODE CONTEXT
		*******************/
		fs = require('fs');
		var path = require('path');
		mkdirp = require('mkdirp');
		rmdirr = require('rmdir');

		var crypto = require('crypto');
		var Buffer = require('buffer').Buffer;

		pathJoin = function(part1, part2){
			if (Array.isArray(part1)){
				if (part1.length == 0) return;

				var totalPath = path.join.apply(this, part1);

				if (part2){
					//If part2 is defined, add it to part1 array
					totalPath = path.join(totalPath, part2);
				}
				return totalPath;
			}

			return path.join(part1, part2);
		}

		if (fs.access){
			fsExists = function(filePath, callback){
				fs.access(filePath, fs.F_OK | fs.R_OK | fs.W_OK, function(err){callback(!err)});
			};
		} else {
			fsExists = fs.exists;
		}

		randomBuffer = function(size){
			if (!(typeof size == 'number' && size > 0 && Math.floor(size) == size)) throw new TypeError('size must be a strictly positive integer');
			var rand = crypto.randomBytes(size);

			return bufToUI8(rand);
		};

		checkReadBuffer = function(b){
			if (typeof b == 'string') return b;
			else if (Buffer.isBuffer(b)) return bufToUI8(b);
			else throw new TypeError('b must be a string or a buffer');
		};

		checkWriteBuffer = function(b){
			if (typeof b == 'string') return b;
			else if (b instanceof Uint8Array) return UI8ToBuf(b);
			else throw new TypeError('b must be a string or a Uint8Array');
		};

		function bufToUI8(b){
			if (!Buffer.isBuffer(b)) throw new TypeError('b must be a buffer');
			var ab = new ArrayBuffer(b.length);
			var ua = new Uint8Array(ab);
			for (var i = 0; i < b.length; i++) ua[i] = b[i];
			return ua;
		}

		function UI8ToBuf(ui8){
			return new Buffer(ui8);
		}
	}

	//if (!sodium) throw new Error('Error on loading Lawncipher : Libsodium is missing');
	if (!Long) throw new Error('Error on loading Lawncipher: Long.js is missing');

	//var from_hex, to_hex;
	var from_base64, to_base64;
	var from_string;

	if (sodium){
		//Referencing missing encoding methods
		from_base64 = sodium.from_base64;
		to_base64 = sodium.to_base64;
		from_string = sodium.from_string;
	}

	var toStringChunkSize = 32767;

	function to_string(bytes) {
		if (typeof TextDecoder === "function") {
			return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
		}

		var numChunks = Math.ceil(bytes.length / toStringChunkSize);
		if (numChunks > 1){
			var totalString = '';
			var sequenceReadOffset = 0;
			for (var i = 0; i < numChunks; i++){
				var currentChunk = Array.prototype.slice.call(bytes, i * toStringChunkSize + sequenceReadOffset, (i + 1) * toStringChunkSize + sequenceReadOffset);
				//Depending on how much we have shifted
				if (currentChunk.length == 0) continue;

				//Checking that we didn't cut the buffer in the middle of a UTF8 sequence.
				//If we did, remove the bytes of the "cut" sequence and
				//decrement sequenceReadOffset for each removed byte
				var sequenceDetectionComplete;
				var sequenceIndex = currentChunk.length;
				var sequenceLength = 0;

				//This loop will read the chunk from its end, looking for sequence start bytes
				do {
					sequenceIndex--;
					var currentByte = currentChunk[sequenceIndex];

					if (currentByte >= 240){ //Beginning of a 4-byte UTF-8 sequence
						sequenceLength = 4;
						sequenceDetectionComplete = true;
					} else if (currentByte >= 224){ //Beginning of a 3-byte UTF-8 sequence
						sequenceLength = 3;
						sequenceDetectionComplete = true;
					} else if (currentByte >= 192){ //Beginning of a 2-byte UTF-8 sequence
						sequenceLength = 2;
						sequenceDetectionComplete = true;
					} else if (currentByte < 128){ //A one byte UTF-8 char
						sequenceLength = 1;
						sequenceDetectionComplete = true;
					}
					//The values between [128, 192[ are part of a UTF-8 sequence.
					//The loop will not exit in that case, and will iterate one byte backwards instead
				} while (!sequenceDetectionComplete);

				var extraBytes = sequenceLength - (currentChunk.length - sequenceIndex);
				for (var j = 0; j < extraBytes; j++){
					sequenceReadOffset--;
					currentChunk.pop();
				}

				totalString += to_string(currentChunk);
			}
			return totalString;
		}

		try {
			return decodeURIComponent(escape(String.fromCharCode.apply(null, bytes)));
		}
		catch (_) {
			throw new TypeError("The encoded data was not valid.");
		}
	}

	function from_hex(str) {
		if (!is_hex(str)) throw new TypeError("The provided string doesn't look like hex data");
		var result = new Uint8Array(str.length / 2);
		for (var i = 0; i < str.length; i += 2) {
			result[i >>> 1] = parseInt(str.substr(i, 2), 16);
		}
		return result;
	}

	function to_hex(bytes) {
		var str = "", b, c, x;
		for (var i = 0; i < bytes.length; i++) {
			c = bytes[i] & 0xf;
			b = bytes[i] >>> 4;
			x = (87 + c + (((c - 10) >> 8) & ~38)) << 8 |
					(87 + b + (((b - 10) >> 8) & ~38));
			str += String.fromCharCode(x & 0xff) + String.fromCharCode(x >>> 8);
		}
		return str;
	}

	function is_hex(s){
		return typeof s == 'string' && s.length % 2 == 0 && /^([a-f]|[0-9])+$/ig.test(s);
	};

	var cryptoFileEncoding = {
		encrypt: scryptFileEncode,
		decrypt: scryptFileDecode,
		decode: scryptFileDecodeHeader
	};

	//var defaultScryptParams = {r: 8, p: 1, opsLimit: 16384};
	var minFileSize = sodium.crypto_secretbox_NONCEBYTES + sodium.crypto_secretbox_MACBYTES + 1;
	var collectionMetaFileModel = {
		indexModel: null,
		indexesSeeds: {},
		collectionBlobSize: 0 //The summed-up sizes of all collection blobs. Index size not taken into account
	};
	var permittedIndexTypes = ['string', 'date', 'number', 'boolean', 'object', 'array', 'buffer', '*'];
	var purgeIntervalValue = 5000;

	/*
	Lawncipher prevents itself from writing enourmous index files.
	If the unencrypted index file exceeds this size (in unencrypted state),
	it will be chunked by the main PearsonBPlusTree.
	*/
	var maxIndexChunkSize = 51200; //(50 * 1024) bytes

	function indexNameRegexBuilder(indexName, rangeOptional){
		var regexStr = '^_';
		if (!indexName || indexName == 'index'){
			regexStr += 'index';
		} else {
			regexStr += '_' + indexName;
		}
		regexStr += '(?:_((?:[a-f]|[0-9]){16})_((?:[a-f]|[0-9]){16}))' + (rangeOptional ? '?' : '') + '$';

		return new RegExp(regexStr, 'i');
	}

	function indexNameParser(indexName){
		var indexNameCheck = indexNameRegexBuilder(indexName);

		return function(fileName){
			if (!indexNameCheck.test(fileName)) return;

			var result = {};
			var extractedAttributes = 0;

			var fileNameParts = fileName.split(/_+/g);
			for (var i = 0; i < fileNameParts.length; i++){
				if (fileNameParts[i] == '') continue;
				if (extractedAttributes == 0){ //Index name
					result.name = fileNameParts[i];
				} else if (extractedAttributes == 1){ //Range start
					try {
						result.rangeStart = hexToLong(fileNameParts[i]);
					} catch (e){
						throw new Error(fileNameParts[i] + ' cannot be parsed to a Long');
					}
				} else if (extractedAttributes == 2){ //Range end
					try {
						result.rangeEnd = hexToLong(fileNameParts[i]);
					} catch (e){
						throw new Error(fileNameParts[i] + ' cannot be parsed to a Long');
					}
					break;
				}
				extractedAttributes++;
			}

			return result;
		}
	}

	var indexNamesRegex = indexNameRegexBuilder(); //Default/main index files regex

	function indexNameBuilder(indexName){
		if (indexName && typeof indexName != 'string') throw new TypeError('when defined, indexName must be a string');

		return function(dataRange){
			if (!(dataRange instanceof PearsonRange)) throw new TypeError('dataRange must be a PearsonRange instance');
			var nameStr = '_';
			if (!indexName || indexName == 'index'){
				nameStr += 'index';
			} else {
				nameStr += '_' + indexName;
			}
			nameStr += '_' + dataRange.toString();

			return nameStr;
		}
	}

	function setCryptoProvider(_cryptoProvider, _async){
		if (typeof _cryptoProvider != 'object') throw new TypeError('_cryptoProvider must be an object');
		if (typeof _cryptoProvider.crypto_secretbox_easy != 'function') throw new TypeError('_cryptoProvider.crypto_secretbox_easy must be a function');
		if (typeof _cryptoProvider.crypto_secretbox_open_easy != 'function') throw new TypeError('_cryptoProvider.crypto_secretbox_open_easy must be a function');

		cryptoProv = _cryptoProvider;
		cryptoProvAsync = _async;
	}

	function setDefaultCryptoProvider(){
		if (!sodium) throw new Error('Libsodium is missing');
		cryptoProv = {
			crypto_secretbox_easy: sodium.crypto_secretbox_easy,
			crypto_secretbox_open_easy: sodium.crypto_secretbox_open_easy
		};

		cryptoProvAsync = false;
	}

	function cordovaPluginSecretBoxEasyProvider(plain, nonce, key, callback, resultEncoding){
		if (resultEncoding && !(resultEncoding == 'uint8array' || resultEncoding == 'text' || resultEncoding == 'hex' || resultEncoding == 'base64')){
			callback(new Error('Invalid resultEncoding: ' + resultEncoding));
			return;
		}

		MiniSodium.crypto_secretbox_easy(plain, nonce, key, function(err, cipher){
			if (err){
				callback(err);
				return;
			}

			if (!resultEncoding || resultEncoding == 'uint8array') callback(undefined, cipher);
			else if (resultEncoding == 'text') callback(undefined, MiniSodium.to_string(cipher));
			else if (resultEncoding == 'hex') callback(undefined, MiniSodium.to_hex(cipher));
			else if (resultEncoding == 'base64') callback(undefined, MiniSodium.to_base64(cipher));
			else throw new Error('Invalid resultEncoding: ' + resultEncoding);
		});
	}

	function cordovaPluginSecretBoxOpenEasyProvider(cipher, nonce, key, callback, resultEncoding){
		if (resultEncoding && !(resultEncoding == 'uint8array' || resultEncoding == 'text' || resultEncoding == 'hex' || resultEncoding == 'base64')){
			callback(new Error('Invalid resultEncoding: ' + resultEncoding));
			return;
		}

		MiniSodium.crypto_secretbox_open_easy(cipher, nonce, key, function(err, plain){
			if (err){
				callback(err);
				return;
			}

			if (!resultEncoding || resultEncoding == 'uint8array') callback(undefined, plain);
			else if (resultEncoding == 'text') callback(undefined, MiniSodium.to_string(plain));
			else if (resultEncoding == 'hex') callback(undefined, MiniSodium.to_hex(plain));
			else if (resultEncoding == 'base64') callback(undefined, MiniSodium.to_base64(plain));
			else throw new Error('Invalid resultEncoding: ' + resultEncoding);
		});
	}

	function useCordovaPluginMiniSodium(){
		if (!window.plugins.MiniSodium) throw new Error('MiniSodium plugin cannot be found');
		MiniSodium = window.plugins.MiniSodium;

		cryptoProv = {
			crypto_secretbox_easy: cordovaPluginSecretBoxEasyProvider,
			crypto_secretbox_open_easy: cordovaPluginSecretBoxOpenEasyProvider
		};

		cryptoProvAsync = true;

		scryptProv = function(password, salt, opsLimit, r, p, keyLength, callback){
			MiniSodium.crypto_pwhash_scryptsalsa208sha256_ll(keyLength, password, salt, opsLimit, r, p, callback);
		};
		scryptProvAsync = true;

		//from_hex = MiniSodium.from_hex;
		//to_hex = MiniSodium.to_hex;
		from_base64 = MiniSodium.from_base64;
		to_base64 = MiniSodium.to_base64;
		from_string = MiniSodium.from_string;
	}

	function doSecretBox(message, nonce, key, callback, resultEncoding){
		if (!(typeof message == 'string' || message instanceof Uint8Array)) throw new TypeError('message must be a string or a Uint8Array');
		if (!(typeof nonce == 'string' || nonce instanceof Uint8Array)) throw new TypeError('nonce must be a string or a Uint8Array');
		if (!(typeof key == 'string' || key instanceof Uint8Array)) throw new TypeError('key must be a string or a Uint8Array');
		if (typeof callback != 'function') throw new TypeError('missing callback');
		if (cryptoProvAsync){

			cryptoProv.crypto_secretbox_easy.apply({}, Array.prototype.slice.call(arguments));
		} else {
			var cipher;
			try {
				cipher = cryptoProv.crypto_secretbox_easy(message, nonce, key, resultEncoding);
			} catch (e){
				callback(e);
				return;
			}
			callback(undefined, cipher);
		}
	}

	function doSecretBoxOpen(cipher, nonce, key, callback, resultEncoding){
		if (!(typeof cipher == 'string' || cipher instanceof Uint8Array)) throw new TypeError('cipher must be a string or a Uint8Array');
		if (!(typeof nonce == 'string' || nonce instanceof Uint8Array)) throw new TypeError('nonce must be a string or a Uint8Array');
		if (!(typeof key == 'string' || key instanceof Uint8Array)) throw new TypeError('key must be a string or a Uint8Array');
		if (typeof callback != 'function') throw new TypeError('missing callback');
		if (cryptoProvAsync){
			cryptoPrv.crypto_secretbox_open_easy.apply({}, Array.prototype.slice.call(arguments));
		} else {
			var plain;
			try {
				plain = cryptoProv.crypto_secretbox_open_easy(cipher, nonce, key, resultEncoding);
			} catch (e){
				callback(e);
				return;
			}
			callback(undefined, plain);
		}
	}

	/*
	* Scrypt provider must have the following interface
	* Uint8Array|String password
	* Uint8Array|String salt
	* Number opsLimit
	* Number r
	* Number p
	* Number keyLength
	* Function callback(err, derivedKey) : optional. _async must be set to true when calling setScryptProvider with such function
	*/
	function setScryptProvider(_scryptProvider, _async){
		if (!_scryptProvider) throw new TypeError('_scryptProvider must be defined');
		if (!(typeof _scryptProvider == 'function' || typeof _scryptProvider == 'string')) throw new TypeError('_scryptProvider must either be a function or a string');
		if (typeof _scryptProvider == 'string'){
			_scryptProvider = _scryptProvider.toLowerCase();
			if (_scryptProvider == 'default' || _scryptProvider == 'reset'){
				setDefaultScryptProvider();
			} else {
				throw new Error('Unsupported scryptProvider value: ' + _scryptProvider);
			}
		} else {
			scryptProv = _scryptProvider;
			scryptProvAsync = _async;
		}
	}

	function setDefaultScryptProvider(){
		scryptProvAsync = false;
		scryptProv = sodium.crypto_pwhash_scryptsalsa208sha256_ll;
	}

	function useCordovaPluginScrypt(){
		if (!window.plugins.scrypt) throw new Error('cordova-plugin-scrypt cannot be found!');

		scryptProvAsync = true;
		scryptProv = cordovaPluginScryptProvider;
	}

	function cordovaPluginScryptProvider(password, salt, opsLimit, r, p, keyLength, callback){
		var dumbSalt = new Array(salt.length);
		for (var i = 0; i < dumbSalt.length; i++) dumbSalt[i] = salt[i];

		var settings = {
			N: opsLimit,
			r: r,
			p: p,
			dkLen: keyLength
		};

		window.plugins.scrypt(function(_result){
			callback(undefined, from_hex(_result));
		}, function(_err){
			callback(_err);
		}, password, dumbSalt, settings);
	}

	function doScrypt(password, salt, opsLimit, r, p, keyLength, cb){
		opsLimit = opsLimit || 16384;
		r = r || 8;
		p = p || 1;
		keyLength = keyLength || 32;

		var argsArray = Array.prototype.slice.call(arguments);

		if (scryptProvAsync){
			scryptProv.apply({}, argsArray);
		} else {
			var derivedKey;
			try {
				derivedKey = scryptProv.apply({}, argsArray.slice(0, 6));
			} catch (e){
				cb(e);
				return;
			}
			cb(undefined, derivedKey);
		}
	}

	//setDefaultScryptProvider();
	//setDefaultCryptoProvider();

	exports.setScryptProvider = setScryptProvider;
	exports.useCordovaPluginScrypt = useCordovaPluginScrypt;

	exports.randomBuffer = randomBuffer;

	exports.init = init;
	function init(cryptoProviderName){
		if (initCalled) return;

		if (cryptoProviderName && typeof cryptoProviderName == 'string'){
			cryptoProviderName = cryptoProviderName.toLowerCase();

			// "minisodium" -> force use of MiniSodium
			// "?minisodium?" -> try to use MiniSodium, fallback to Libsodium.js if needed
			if (cryptoProviderName == '?minisodium?' || cryptoProviderName == 'minisodium'){
				//Allow Libsodium to be missing, in case MiniSodium is available
				if (window && window.plugins && window.plugins.MiniSodium){
					//Shortcut reference
					MiniSodium = window.plugins.MiniSodium;
					//Referencing MiniSodium to sodium, to allow access to constants normally available under sodium.crypto_*
					sodium = MiniSodium;
					//Initializing Lawncipher to use MiniSodium
					useCordovaPluginMiniSodium();
				} else {
					if (cryptoProviderName == '?minisodium?') useDefaults();
					else throw new Error('MiniSodium is missing');
				}
			} else if (cryptoProviderName == 'libsodium' || cryptoProviderName == 'sodium' || cryptoProviderName == 'nacl'){
				useDefaults();
			} else {
				throw new Error('Unknown cryptoProviderName: ' + cryptoProviderName);
			}
		} else useDefaults();

		function useDefaults(){
			if (!sodium) throw new Error('Error on initializing Lawncipher : Libsodium is missing');
			setDefaultCryptoProvider();
			setDefaultScryptProvider();
		}

		initCalled = true;
	}

	exports.db = Lawncipher;

	function Lawncipher(rootPath, _fs){
		if (!initCalled) throw new Error('You must call Lawncipher.init() before using Lawncipher.db');

		if (!(typeof rootPath == 'string' && rootPath.length > 0)) throw new TypeError('rootPath must be a non-null string');

		if (!nodeContext){
			if (!(_fs && typeof _fs == 'object')) throw new TypeError('_fs must be defined and must be an object');

			fs = _fs;

			fsExists = fs.exists;
			rmdirr = fs.rmdirr;
			mkdirp = fs.mkdirp;
		}

		var rootKey, rootSalt;
		var rootIndex;
		var rootIndexPath = pathJoin(rootPath, '_index');

		var openCollections = [];

		var lc = this;

		function openLawncipher(_rootKey, callback, rootIndexHeader){
			if (!_rootKey) return false; //No root key provided
			if (rootKey) return false; //Already open
			if (typeof callback != 'function') throw new Error('callback must be a function');

			if (!(_rootKey instanceof Uint8Array && _rootKey.length == sodium.crypto_secretbox_KEYBYTES)){
				callback(new Error('rootKey must be an Uint8Array and ' + sodium.crypto_secretbox_KEYBYTES + ' bytes long'));
				return;
			}

			if (rootIndexHeader){
				//Checking that it's an object
				if (typeof rootIndexHeader != 'object') throw new TypeError('when defined, rootIndexHeader must be an object');
				//Checking rootIndexHeader's attributes
				scryptCheckFileHeader(rootIndexHeader);
			}

			rootKey = _rootKey;

			//Checking wether the root folder exists. Creating it otherwise. Loading main lawncipher `_index` file
			fsExists(rootPath, function(exists){
				if (!exists){
					mkdirp(rootPath, function(err){
						if (err){
							console.error('Error while creating root folder for lawnchiper: ' + err);
							callback(err);
							return;
						}
						setTimeout(loadRootIndex, 0);
					});
				} else {
					setTimeout(loadRootIndex, 0);
				}
			});

			function loadRootIndex(){
				//Checking whether the main `_index` file exists.
				fsExists(rootIndexPath, function(exists){
					if (exists){
						fs.readFile(rootIndexPath, function(err, rootIndexBuffer){
							if (err){
								console.error('Error while reading the rootIndex file: ' + err);
								callback(err);
								return;
							}

							rootIndexBuffer = checkReadBuffer(rootIndexBuffer);

							rootIndexHeader = rootIndexHeader || cryptoFileEncoding.decode(rootIndexBuffer);

							rootSalt = rootIndexHeader.salt;

							cryptoFileEncoding.decrypt(rootIndexBuffer, rootKey, rootIndexHeader, function(err, rootIndexStr){
								if (err){
									rootKey = undefined;

									var errMsg;
									if (typeof err == 'string') errMsg = err;
									else if (typeof e == 'object') errMsg = e.message || e;
									else errMsg = e;

									callback(errMsg);
									return;
								}

								rootIndexStr = to_string(rootIndexStr);

								var _rootIndex;
								try {
									_rootIndex = JSON.parse(rootIndexStr);
								} catch (e){
									callback('INVALID_INDEX');
									return;
								}
								if (!Array.isArray(_rootIndex)){
									callback('INVALID_INDEX');
									return;
								}
								rootIndex = _rootIndex;
								setTimeout(loadCollections, 0);
							});
						});
					} else {
						rootIndex = [];
						//If we use Lawncipher.db.open(), a salt must be used (but it's just a placeholder)
						//It is defined at this stage though if we use Lawncipher.db.openWithPassword()
						if (!rootSalt) rootSalt = randomBuffer(16);
						//Save the rootIndex on flash/disk
						saveRootIndex(callback);
					}
				});
			}

			//Loading collections. Or more precisely checking their description format. But why?
			function loadCollections(){
				if (rootIndex.length == 0){
					console.log('No collection description to load');
					callback();
					return;
				}

				//This loop has async-only behavior, hence the async-handling code in this method is useless and commented out
				for (var i = 0; i < rootIndex.length; i++){
					loadOne(rootIndex[i]);
				}

				callback();

				function loadOne(c){
					var missingVarName;
					if (!c['name']) missingVarName = 'name';
					if (!c['key']) messageVarName = 'key;'
					if (missingVarName){
						console.error('Missing variable ' + missingVarName + ' from collection description ' + JSON.stringify(c));
						//endCount++;
						//endLoad();
						//return;
					}
				}
			}
		}

		/**
		* Save the root lawncipher index
		* @private
		* @param {Function} callback - callback function, receiving potential error messages as strings. If the provided value is not a function, the function screams at you with an exception
		*/
		function saveRootIndex(cb){
			if (typeof cb != 'function') throw new TypeError('cb must be a function');

			var rootIndexStr = JSON.stringify(rootIndex);

			//var encryptedIndexBuffer = cryptoFileEncoding.encrypt(from_string(rootIndexStr), rootKey, rootSalt);

			cryptoFileEncoding.encrypt(from_string(rootIndexStr), rootKey, function(err, encryptedIndexBuffer){
				if (err){
					cb(err);
					return;
				}

				encryptedIndexBuffer = checkWriteBuffer(encryptedIndexBuffer);
				fs.writeFile(rootIndexPath, encryptedIndexBuffer, cb);
			}, rootSalt);
		}

		/**
		* Open the lawncipher document store
		* @param {Uint8Array|String} _rootKey|_rootPassword - the root key or root password from which each collection's main encryption key will be derived. If lawncipher is empty, the provided rootKey will be set; if it isn't empty, it has to match the rootKey that was provided on creation
		* @param {Function} callback - callback function. Receiving only an `err` (error) parameter (a string)
		*/
		this.open = function(_rootKey, callback){
			openLawncipher(_rootKey, callback);
		};

		this.openWithPassword = function(rootPassword, callback){
			if (!(typeof rootPassword == 'string' && rootPassword.length > 0)) throw new TypeError('rootPassword must be a non-empty string');
			if (typeof callback != 'function') throw new TypeError('callback must be a function');

			fsExists(rootIndexPath, function(exists){
				if (!exists){
					/*
					*	If the root index file doesn't exist, then it will be created on the first openLawncipher call
					*	We are generating here the salt that will be used to derive the password into the encryption key for the root index
					*	This salt will be saved as part of the "root index" file format
					*/
					var passSalt = randomBuffer(16);
					rootSalt = passSalt;

					deriveAndOpen(rootPassword, rootSalt, callback);
				} else {
					/*
					*	The root index file already exists. We are going to read the salt from it
					*	And then derive the password into an encryption key
					*/
					fs.readFile(rootIndexPath, function(err, rootIndexFileBuffer){
						if (err){
							callback(err);
							return;
						}

						rootIndexFileBuffer = checkReadBuffer(rootIndexFileBuffer);

						var rootIndexContents;
						try {
							rootIndexContents = cryptoFileEncoding.decode(rootIndexFileBuffer);
						} catch (e){
							callback(e);
							return;
						}

						rootSalt = rootIndexContents.salt;

						deriveAndOpen(rootPassword, rootSalt, callback, rootIndexContents);
					});
				}
			});

			function deriveAndOpen(pass, salt, cb, rootIndexContents){
				doScrypt(pass, salt, undefined, undefined, undefined, 32, function(err, derivedKey){
					if (err){
						cb(err);
						return;
					}

					openLawncipher(derivedKey, cb, rootIndexContents);
				});
			}

		};

		/**
		* Closing the lawncipher, if open
		*/
		this.close = function(){
			//Trying to attract the GC's attention by setting the `rootKey` and `rootIndex` to null
			if (rootKey || rootIndex){
				rootKey = null;
				rootIndex = null;
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
			return !!(rootKey && rootIndex);
		};

		/**
		* Setting a new root key and re-encrypt collection's indexes
		* @param {Uint8Array} newRootKey - the new root key to be used in lawncipher
		* @param {Function} callback - receving (err), defined if an error occured
		*/
		this.changeRootKey = function(newRootKey, callback){
			if (!(newRootKey && (newRootKey instanceof Uint8Array && newRootKey.length == sodium.crypto_secretbox_KEYBYTES))) throw new TypeError('newRootKey must be an Uint8Array and ' + sodium.crypto_secretbox_KEYBYTES + ' bytes long');
			if (typeof callback != 'function') throw new TypeError('callback must be a function');

			if (!(rootKey && rootIndex)){
				callback(new Error('lawncipher is not currently open'));
				return;
			}

			rootKey = newRootKey;
			rootSalt = randomBuffer(16);
			saveRootIndex(callback);
		};

		this.changePassword = function(newPassword, callback){
			if (!(typeof newPassword == 'string' && newPassword.length > 0)) throw new TypeError('newPassword must be a non-empty string');
			if (typeof callback != 'function') throw new TypeError('callback must be a function');

			if (!(rootIndex && rootIndex)){
				callback(new Error('lawncipher is not currently open'));
				return;
			}

			var newSalt = randomBuffer(16);

			doScrypt(newPassword, newSalt, undefined, undefined, undefined, 32, function(err, derivedKey){
				if (err){
					callback(err);
					return;
				}

				rootKey = derivedKey;
				rootSalt = newSalt;
				saveRootIndex(callback);
			});
		};

		/**
		* Getting an existing collection, or creating one
		* @param {String} name - the collection's name
		* @param {Function} _callback - callback function, receiving errors or the constructed Collection object (err, collection)
		* @param {Object|Array<String>} [_indexModel] - the index model. The attributes that will be extracted and/or saved in the collection's _index file. The query-able data. If the collection already exists, this parameter will simply be ignored. Optional parameter.
		*/
		this.collection = function(name, callback, _indexModel){
			if (typeof name != 'string') throw new TypeError('name must be a string');

			if (typeof callback != 'function') throw new TypeError('callback must be a function');

			//If an _indexModel is provided, then check that it's a valid one, before trying to open a collection and try to set it.
			var indexModel;
			if (_indexModel){
				if (typeof _indexModel != 'object'){
					callback(new TypeError('when defined, _indexModel must be an object'));
					return;
				}

				var validationResult = validateIndexModel(_indexModel);
				if (validationResult){
					callback(new Error('Invalid index model: ' + validationResult));
					return;
				}

				indexModel = _indexModel;
			}

			if (!lc.isOpen()){
				callback(new Error('lawncipher is not open yet'));
				return;
			}

			if (!indexModel){
				var c = new Collection(name, callback);
				openCollections.push(c);

				/*
				* Returning the new Collection object, that will call
				* the `callback` as well. If the returned lawncipher
				* instance is used before the callback is executed, race
				* condition guaranteed.
				*/
				return c;
			} else {
				/*
				* After the collection is loaded, the indexModel is set.
				* The callback is called once the indexModel has been set
				* Note that the callback can then receive the errors of
				* collection loading and setIndexModel
				*/
				var c = new Collection(name, function(err, _collection){
					if (err){
						callback(err);
						return;
					}

					_collection.setIndexModel(indexModel, function(err){
						if (err){
							callback(err, _collection);
							return;
						}

						callback(undefined, _collection);
					});
				});
				openCollections.push(c);

				return c; //Returning the new Collection object, that will call the `callback` as well. If the returned lawncipher instance is used before the callback is executed, race condition guaranteed.
			}
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
			for (var i = 0; i < rootIndex.length; i++) collectionsNames.push(rootIndex[i].name);
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
			for (var i = 0; i < rootIndex.length; i++){
				if (rootIndex[i].name == collectionName){
					collectionPosition = i;
					break;
				}
			}

			//Recursively deleting the collection's folder
			var docsPath = pathJoin(rootPath, collectionName);
			rmdirr(docsPath, function(err){
				if (err){
					console.error('Error while dropping documents files of collection ' + collectionName + ': ' + err);
					callback(err);
					return;
				}
				//Removing the collection from the main index and saving it
				rootIndex.splice(collectionPosition, 1);
				saveRootIndex(function(err){
					if (err) console.error('Error while saving new collection index, after dropping collection ' + collectionName + ': ' + err);
					callback(err);
				});
			});

		};

		/**
		* Lawncipher Collection object constructor
		* @constructor
		* @private
		* @param {String} name - collection name. If a collection with this name already exists, it is loaded. Otherwise, a new collection will be created, using the current rootKey.
		* @param {Function} cb - callback function receiving (err, collection). File, format and rootKey errors can occur.
		*/
		function Collection(name, cb){
			var k; //The collection's main encryption key
			var self = this;
			var collectionName = name;
			var collectionIndexModel;
			var docCount = 0;
			var collectionSize = 0;
			var collectionIndexSize = 0;

			/*
			* purgeInterval: the reference to the "scheduled purging cycle" (the cycle that deletes the expired documents). To be used to call clearInterval when closing the collection
			* purgeOngoing: state variable indicating whether (a purge is needed && the purge is ongoing)
			*/
			var purgeInterval, purgeOngoing = false;

			var collectionDescription; //The object to be added to the collection list, describing the current collection
			var collectionPath = pathJoin(rootPath, collectionName); //Root directory of the collection
			var metaFilePath = pathJoin(collectionPath, '_meta');
			var ttlsFilePath = pathJoin(collectionPath, '_ttls');
			var legacy_indexFilePath = pathJoin(collectionPath, '_index'); //Index file of the collection

			var collectionMeta = null; // An object, containing the settings/meta-data of the collection (PearsonSeed, IndexModel,...). Sourced from the _meta file
			var collectionTTLs = null, collectionTTLsChanged = false;

			var collectionIndex; // The index instance, containing the <docId, doc> pairs
			var searchIndices = {}; //<FieldName, Index>
			var indexesSeeds = {};

			for (var i = 0; i < rootIndex.length; i++){
				if (rootIndex[i].name == name){
					collectionDescription = rootIndex[i];
					break;
				}
			}

			if (!collectionDescription){
				//If collectionDescription doesn't exist,
				//it means that this current collection is new and empty
				collectionDescription = {
					name: collectionName,
					key: to_hex(randomBuffer(32))
				};

				//if (collectionIndexModel) collectionDescription.indexModel = clone(collectionIndexModel)

				rootIndex.push(collectionDescription);
				saveRootIndex(function(err){
					if (err){
						cb(err);
						return;
					}

					initCollectionFiles();
				});
			} else initCollectionFiles();

			function initCollectionFiles(){
				fsExists(metaFilePath, function(metaExists){
					if (metaExists){
						fs.readFile(metaFilePath, function(err, data){
							if (err){
								console.error('Error while reading _meta file for collection ' + collectionName + ': ' + err);
								cb(err);
								return;
							}

							if (!k) k = from_hex(collectionDescription.key);

							var encryptedMetaBuffer = checkReadBuffer(data);

							cryptoFileEncoding.decrypt(encryptedMetaBuffer, k, undefined, function(err, decryptedMetaBuffer){
								if (err){
									console.error('Can\'t decrypt _meta file for collection ' + collectionName);
									console.error(JSON.stringify(e));
									cb('INVALID_ROOTKEY');
									return;
								}

								try {
									collectionMeta = JSON.parse(to_string(decryptedMetaBuffer));
								} catch (e){
									cb('INVALID_META');
									return;
								}

								collectionIndexModel = collectionMeta.indexModel;
								indexesSeeds = collectionMeta.indexesSeeds;

								collectionIndex = new Index(rootPath, collectionName, 'index', k, indexesSeeds._index, function(loadIndexErr){
									if (loadIndexErr){
										console.error('Load error - cannot init the collection index: ' + err);
										cb(err);
										return;
									}

									//Existing collection -> loading searchIndices, if any
									loadAllSearchIndices(endInit);
								});
							});
						});

					} else {
						fsExists(legacy_indexFilePath, function(legacyIndexExists){
							if (legacyIndexExists){
								migrateV1DocumentsIndex();
								return;
							}

							var newMetaIndex = clone(collectionMetaFileModel);

							indexesSeeds = {_index: PearsonSeedGenerator()};
							newMetaIndex.indexesSeeds = indexesSeeds;

							collectionMeta = newMetaIndex;

							mkdirp(collectionPath, function(err){
								if (err){
									cb(err);
									return;
								}

								saveMetaIndex(function(err){
									if (err){
										cb(err);
										return;
									}

									collectionIndex = new Index(rootPath, collectionName, 'index', k, indexesSeeds._index, function(loadIndexErr){
										if (err){
											console.error('Load error - cannot inint the collection index: ' + err);
											cb(err);
											return;
										}

										purgeInterval = setInterval(ttlCheckAndPurge, purgeIntervalValue);
										cb(undefined, self);
									});
								});
							});
						});
					}
				});
			}

			function endInit(){
				//Checking that if an indexModel is provided as a parameter of this call, it hasn't changed with the one already saved on file.
				/*if (indexModel && collectionMeta.indexModel){
					if (!deepObjectEquality(collectionMeta.indexModel, indexModel)){
						//If it does, update
						console.log('Updating indexModel of collection ' + collectionName + ' to ' + JSON.stringify(indexModel));
						collectionMeta.indexModel = indexModel;
						collectionDescription.indexModel = indexModel;
						saveRootIndex(function(err){ //Saving root Lawncipher index (updating collection description)
							if (err){
								cb(err);
								return;
							}
							saveMetaIndex(function(err){ //Saving collection index, with updated indexModel attribute
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
					indexModel = collectionMeta.indexModel;
					endCollectionLoad();
				}*/

				/*endCollectionLoad();

				function endCollectionLoad(){
					purgeInterval = setInterval(ttlCheckAndPurge, purgeIntervalValue);
					cb(undefined, self);
				}*/

				purgeInterval = setInterval(ttlCheckAndPurge, purgeIntervalValue);
				cb(undefined, self);
			}

			function migrateV1DocumentsIndex(){
				console.log('Migrating DB from v1');
				fs.readFile(legacy_indexFilePath, function(err, data){
					if (err){
						console.error('Error while reading index file for collection ' + collectionName + ': ' + err);
						cb(err);
						return
					}

					var encryptedFileBuffer = checkReadBuffer(data);
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

					doSecretBoxOpen(cipherBuffer, nonceBuffer, k, function(err, decryptedIndexStr){
						if (err){
							console.error('Can\'t decrypt the index file for collection ' + collectionName);
							console.error(err);
							cb('INVALID_ROOTKEY');
							return;
						}

						try {
							serializedIndex = JSON.parse(decryptedIndexStr);
						} catch (e){
							cb('INVALID_INDEX');
							return;
						}

						//Deserialize every object in the index.
						var documentsIndex = {documents: {}, indexModel: serializedIndex.indexModel, docCount: serializedIndex.docCount, collectionSize: serializedIndex.collectionSize};

						var docsIds = Object.keys(serializedIndex.documents);
						for (var i = 0; i < docsIds.length; i++){
							documentsIndex.documents[docsIds[i]] = clone(serializedIndex.documents[docsIds[i]]);
							documentsIndex.documents[docsIds[i]].index = deserializeObject(documentsIndex.documents[docsIds[i]].index);
						}

						//Load tree
						var collectionIndexSeed = PearsonSeedGenerator();
						indexesSeeds._index = collectionIndexSeed;

						collectionIndex = new Index(rootPath, collectionName, 'index', k, indexesSeeds._index, function(loadIndexErr){
							if (loadIndexErr){
								console.error('Migration error - cannot init the Index instance: ' + err);
								cb(err);
								return;
							}

							//Mass doc insert, with triggers
							for (var i = 0; i < docsIds.length - 1; i++){
								collectionIndex.add(docsIds[i], documentsIndex.documents[docsIds[i]], null, true);
							}
							//Inserting the last doc, and trigger the writes
							collectionIndex.add(docsIds[docsIds.length - 1], documentsIndex.documents[docsIds[docsIds.length - 1]]);

							collectionMeta = {
								indexModel: documentsIndex.indexModel,
								collectionBlobSize: documentsIndex.collectionSize,
								indexesSeeds : indexesSeeds
							};

							saveMetaIndex(function(err){
								if (err){
									console.error('Migration error - cannot save collection meta data: ' + err);
									cb(err);
									return;
								}

								endInit();
							});
						});
					}, 'text');
				});
			}

			function loadAllSearchIndices(cb){
				if (typeof cb != 'function') throw new TypeError('cb must be a function');

				if (!collectionIndexModel){ //No indexModel -> no search indices
					cb();
					return;
				}

				//Iterating over each attribute in the indexModel, to see which ones have indexing enabled
				var indexList = [];
				var indexModelAttributes = Object.keys(collectionIndexModel);
				for (var i = 0; i < indexModelAttributes.length; i++){
					//The current attribute has indexing enabled
					if (collectionIndexModel[indexModelAttributes[i]].index){
						indexList.push(indexModelAttributes[i]);
					}
				}

				if (indexList.length == 0){
					//Found no attributes that have indexing enabled -> get out of this method
					cb();
					return;
				}

				//Async loop (featuring callback hells), that loads the collection's search indices
				var loadIndex = 0;

				function loadOne(){
					var currentAttribute = indexList[loadIndex];
					loadSearchIndex(currentAttribute, function(err){
						if (err){
							cb();
							return;
						}

						loadNext();
					});
				}

				function loadNext(){
					loadIndex++;
					if (loadIndex == indexList.length){
						cb();
					} else {
						loadOne();
					}
				}

				loadOne();
			}

			function loadSearchIndex(fieldName, cb){
				//fieldName _index is disallowed, by design (conflicting with the collection's central index)
				if (fieldName == '_index'){
					cb();
					return;
				}

				if (!indexesSeeds[fieldName]){
					//This is a new index, as it doesn't have a seed yet.
					//Generating one
					indexesSeeds[fieldName] = PearsonSeedGenerator();
					saveMetaIndex(function(err){
						if (err){
							cb(err);
							return;
						}

						initIndex();
					});
				} else {
					//The index seems to already exist, as it has a seed.
					//Checking files presence, just to be sure.

					initIndex();
				}


				function initIndex(){
					var i = new Index(rootPath, collectionName, '_' + fieldName, k, indexesSeeds[fieldName], function(loadSearchIndex){
						if (loadIndexErr){
							cb(loadIndexErr);
							return;
						}

						searchIndices[fieldName] = i;
						cb();
					});
				}
			}

			/**
			* Delete a search index in the current collection, if it exists. If an index doesn't exist
			* @param {String} fieldName - the name of the indexed field. A valid fieldName is part of the indexModel
			* @param {Function} cb - callback function. Receives (err), where `err` is an error if one occurred
			*/
			function deleteSearchIndex(fieldName, cb){
				//Checking whether the index exists
				//Since the seed will be the last thing to be removed, so this test shall have few false positives
				if (!indexesSeeds[fieldName]){
					cb();
					return;
				}

				//Getting the index fragments list
				fs.readdir(collectionPath, function(err, colFileList){
					if (err){
						cb(err);
						return;
					}

					if (colFileList.length == 0){
						/*
						* No index fragment file has been found. However, an index seed exists for fieldName
						* -> deleteIndexSeed();
						*/
						deleteIndexSeed(cb);
						return;
					}

					var searchIndexRegex = indexNameRegexBuilder(fieldName);
					var indexFragmentsList = [];
					for (var i = 0; i < colFileList.length; i++){
						if (searchIndexRegex.test(colFileList[i])) indexFragmentsList.push(colFileList[i]);
					}

					if (indexFragmentsList.length == 0){ //No files found for that search index
						/*
						* No index fragment file has been found. However, an index seed exists for fieldName
						* -> deleteIndexSeed();
						*/
						deleteIndexSeed(cb);
						return;
					}

					//Fragment deletion async loop here. Check that there is work to do...

					function deleteFragments(next){
						var deletionIndex = 0;

						function deleteOneFragment(){
							fs.unlink(pathJoin(collectionPath, indexFragmentsList[deletionIndex]), function(err){
								if (err){
									cb(err);
									return;
								}

								nextDeletion();
							});
						}

						function nextDeletion(){
							deletionIndex++;
							if (deletionIndex == indexFragmentsList.length){
								if (typeof next == 'function') next();
							} else {
								deleteOneFragment();
							}
						}

						deleteOneFragment();
					}

					deleteFragments(function(){
						deleteIndexSeed(cb);
					});
				});

				function deleteIndexSeed(next){
					//Remove the index's seed from indexesSeeds, and the Index instance.
					delete indexesSeeds[fieldName];
					delete searchIndices[fieldName];
					//Re-save the _meta file of the collection, with the index seed removed. Get out of the this deletion method through cb
					saveMetaIndex(next);
				}
			}

			function docToBlobAndIndex(doc){
				if (!doc) throw new TypeError('doc annto be undefined or null');

				var blob, index, ttl;

				var td = typeof doc;
				if (td == 'string' || doc instanceof Uint8Array){
					if (doc.length === 0) throw new TypeError('empty document');
					blob = doc;
				} else if (td == 'object'){
					if (Array.isArray(doc)){ // An Array cannot be stored as index data -> blob
						blob = doc;
					} else { //A non-null empty object, that is not a Uint8Array nor an Array
						//Check the attributes in that object
						//If we have __index or __blob. -> Explicit mode
						if (doc.__index || doc.__blob){
							if (doc.__index) index = doc.__index;
							if (doc.__blob) blob = doc.__blob;
							if (doc.__ttl) ttl = doc.__ttl;
						} else { //Implicit mode.
							//But what if there is no index model? Save doc as blob. We are blob-first after all
							if (!collectionIndexModel){
								blob = doc;
							} else {
								//If there are attributes that are not in the index model
								//it extracts the attributes that are part of the index model
								var hasExtraAttributes = false;
								var docAttributes = Object.keys(doc);
								for (var i = 0; i < docAttributes.length; i++){
									if (!collectionIndexModel[docAttributes[i]]){
										hasExtraAttributes = true;
										break;
									}
								}

								if (hasExtraAttributes){
									index = {};
									blob = doc;
									var indexAttributes = Object.keys(collectionIndexModel);
									for (var i = 0; i < indexAttributes.length; i++){
										index[indexAttributes[i]] = doc[indexAttributes[i]];
									}
								} else {
									//All the attributes of doc fit in the model. Hence save as indexData
									index = doc;
								}
							}
						}
					}
				} else {
					throw new Error('doc must be either be a string, an object or a Uint8Array');
				}

				return {
					b: blob,
					i: index,
					t: ttl
				};
			}

			/*
			* Methods to manage index models
			* Practical note : we discourage the use of setIndexModel
			* on a non-empty collection, especially if it has a non-negligeable
			* size. Such call will force Lawncipher to adapt each and every
			* document in the colection to the new indexModel
			*/
			this.getIndexModel = function(){
				return collectionIndexModel && clone(collectionIndexModel);
			};

			/**
			* Set the indexModel for this collection. To be preferably called right after the collection's creation
			* @param {Object|Array<String>} indexModel - the document model to be used for this collection.
			* @param {Function} callback - the callback function, that gets called once the indexModel is saved and applied on all the indexed documents of the collection. Receives (err) if an error occurred
			* @param {Boolean} [doNotApplyModel] - a boolean indicating whether the indexModel should or not be applied to documents already in the collection
			*/
			this.setIndexModel = function(indexModel, cb, doNotApplyModel){
				if (typeof indexModel != 'object') throw new TypeError('indexModel must be an object');
				if (typeof cb != 'function') throw new TypeError('callback must be an function');

				var validationResult = validateIndexModel(indexModel);
				if (validationResult){
					cb(new Error('Invalid index model: ' + validationResult));
					return;
				}

				//Check whether there is an existing model and whether the provided model is different
				if (collectionMeta.indexModel && deepObjectEquality(indexModel, collectionMeta.indexModel)){
					//Do nothing. The model hasn't changed!
					cb();
					return;
				}

				if (doNotApplyModel){
					saveModel();
					return;
				}

				//Adapt docs
				/*
				*	-Running validateIndexAgainstModel and resave every indexed doc (iterate leaf by leaf)
				*	-Recheck unicity and id for every doc? Detect unicity&id differences from previous model
				*	-Id field change should not be allowed (if one already exists)! Id creation is however allowed.
				*	-Detect indexing differences with previous indexModel if any, with the following cases to be handled
				*		-index: true, unique: false -> index: true, unique: true  :: check that every indexed field value is not pointing to more than one doc (and re-instanciating the index with the correct parameters at the end of this method)
				*		-index: true, unique: false -> index: false, unique: true :: delete index. check that every value in this field is unique across the collection
				*		-index: true, unique: false -> index: false, unique: false :: delete index.
				*		-index: true, unique: true -> index: true, unique: false :: nothing special to do, aside instanciating the index in consequence in the future (and re-instanciating it at the end of this method too)
				*		-index: true, unique: true -> index: false
				*		..... Not complete
				*
				*		-unique: true -> unique: false :: nothing to do
				*		-unique: false -> unique: true :: checking that every value is unique accross the collection
				*		-index: true -> index: false :: index deletion
				*		-index: false -> index: true :: index construction
				*
				*/

				console.error('Not yet implemented : apply the new indexModel on existing collection documents')

				self.isIndexModelCompatible(indexModel, function(err, isCompatible, offendingDocs){
					if (err){
						cb(err);
						return;
					}


				});

				saveModel();

				function saveModel(){
					//Save model as part of collection meta
					collectionIndexModel = indexModel;
					collectionMeta.indexModel = indexModel;
					saveMetaIndex(function(err){
						if (err){
							cb(err);
							return;
						}

						//Save model as part of root Lawncipher index
						collectionDescription.indexModel = clone(collectionIndexModel);
						saveRootIndex(cb);
					});
				}
			};

			/**
			* Remove the index model of this collection, if any
			* @param {Function} cb - callback function, receiving (err), where `err` is the error if one occurred
			*/
			this.clearIndexModel = function(cb){
				if (typeof cb != 'function') throw new TypeError('cb must be a function');

				if (!collectionIndexModel){ //No index model in place for this collection -> nothing to do!
					cb();
					return;
				}

				collectionIndexModel = null;
				collectionMeta.indexModel = null;
				collectionDescription.indexModel = null;

				saveMetaIndex(function(err){
					if (err){
						cb(err);
						return;
					}

					saveRootIndex(cb);
				});
			};

			/**
			* Check whether a transition to a given index model is possible, given the collection's existing documents
			* @param {Object} indexModel - the indexModel to be tested
			* @param {Function} cb - callback function, that receives (err, isCompatible, offendingDocs). `err` is an error, and is defined if one occurred. `isCompatible` is a boolean describing whether the model is compatible with the collection's documents. `offendingDocs` is a Hash<DocId, Hash<FieldName, Reason>>, describing the documents that "made the indexModel not compatible"
			*/
			this.isIndexModelCompatible = function(indexModel, cb){
				if (typeof indexModel != 'object') throw new TypeError('indexModel must be an object');
				if (typeof cb != 'function') throw new TypeError('cb must be a function');

				var indexValidationResult = validateIndexModel(indexModel);
				if (indexValidationResult){
					cb(new Error(indexValidationResult));
					return;
				}

				if (deepObjectEquality(indexModel, collectionIndexModel)){
					//If the indexModel is equal to the collectionIndexModel, then indexModel HAS to be compatible. (Transitivity)
					cb(undefined, true);
					return;
				}

				//Detect the fields that are already unique and the one that determines documents' IDs
				var currentIdField;
				var currentUniqueFields;

				if (collectionIndexModel){
					for (var indexField in collectionIndexModel){
						if (collectionIndexModel[indexField].id) currentIdField = indexField;
						else if (collectionIndexModel[indexField].unique) ((currentUniqueFields && currentUniqueFields.push(indexField)) || currentUniqueFields.push(indexField));
					}
				}

				//Detect the field that will need to become unique or that will determine the document IDs
				var idField;
				var uniqueFields = [];

				for (var indexField in indexModel){
					if (indexModel[indexField].id) idField = indexField;
					else if (indexModel[indexField].unique) uniqueFields.push(indexField);
				}

				//Detect unicity and id changes
				if (currentIdField !== idField){
					console.error('Modifying which field is the "Id" field is currently forbidden and unsupported in Lawncipher. Watch out for future releases...');
					cb('ID_FIELD_MODIFICATION_FORBIDDEN');
					return;
				}

				//Detecting unicity flags changes
				var uniqueFieldsAdditions = [];
				var uniqueFieldsDeletions = [];

				//Detecting unicity deletion
				for (var i = 0; i < currentUniqueFields.length; i++){
					var currentUniqueField = currentUniqueFields[i];
					var currentFieldFound = false;
					for (var j = 0; j < uniqueFields.length; j++){
						if (uniqueFields[j] == currentUniqueField){
							currentFieldFound = true;
							break;
						}
					}

					if (!currentFieldFound) uniqueFieldsDeletions.push(currentUniqueField);
				}

				//Detecting unicity addition
				for (var i = 0; i < uniqueFields.length; i++){
					var newUniqueField = uniqueFields[i];
					var newFieldFound = false;
					for (var j = 0; j < currentUniqueFields.length; j++){
						if (currentUniqueFields[j] == newUniqueField){
							newFieldFound = true;
							break;
						}
					}

					if (!newFieldFound) uniqueFieldsAdditions.push(newUniqueField);
				}

				/*if (currentIdField && idField && currentIdField != idField){
					cb(new Error('ID_FIELD_CHANGE_FORBIDDEN'));
					return;
				} else if (currentIdField && !idField){
					cb(new Error('ID_FIELD_REMOVAL_FORBIDDEN'));
					return;
				}*/

				var indexNodeIterator = collectionIndex.nodeIterator();
				var currentNode;

				var offendingDocs = {};
				var offendingDocsCount = 0;

				function addOffendingReason(docId, field, reason){
					if (offendingDocs[docId]){
						offendingDocs[docId][field].push(reason);
					} else {
						offendingDocs[docId] = {};
						offendingDocs[docId][field] = [reason];
						offendingDocsCount++;
					}
				}

				function processNode(){
					//Note: when retrieving with forQuery == false (like here), there is no immutability on the retrieved currentSubCollection
					//i.e : if you modify a doc in currentSubCollection, you have altered the index's memory, and the change could be saved
					var currentSubCollection = currentNode.getBinnedRange().subCollection;
					var currentSubCollectionList = Object.keys(currentSubCollection);

					if (currentSubCollectionList.length == 0){ //If there is no data in the current tree leaf, go to the next one!
						nextNode();
						return;
					}

					//Verify data types
					var currentDoc, currentDocId;
					for (var i = 0; i < currentSubCollectionList.length; i++){
						currentDocId = currentSubCollectionList[i];
						currentDoc = currentSubCollection[currentDocId];
						if (!currentDoc.index) continue; //The current document doesn't have indexed data. Skip
						//currentDoc now contains the indexed data for docId currentDocId
						currentDoc = currentDoc.index;

						/*
						* Beware, this is dirty, but it should work
						* To detect all the fields that cause a type mismatch:
						* -Detect mismatch
						* -If a type mismatch is detected
						*		-clone the index data (if the this the first mismatching field detected for the current doc)
						*		-remove the offending field
						*		-add the fieldName to a typeMismatches array
						* -Loop until no type mismatch is detected
						*/
						var typeMismatches = [];
						var validationResult = validateIndexAgainstModel(currentDoc, indexModel);
						while (typeof validationResult == 'string'){ //validationResult contains the name of the offending field
							if (typeMismatches.length == 0){
								//First mismatch detected for the currentDoc -> clone(currentDoc) (because there is no object immutability in JS, unless you force it...);
								currentDoc = clone(currentDoc);
							}
							delete currentDoc[validationResult];
							typeMismatches.push(validationResult);

							validationResult = validateIndexAgainstModel(currentDoc, indexModel);
						}

						//We exited the loop -> what is left in currentDoc has types that are valid for the given indexModel
						//Furthermore, the offending fields have their names in typeMismatches

						for (var j = 0; j < typeMismatches.length; j++){
							addOffendingReason(currentDocId, typeMismatches[j], 'type_mismatch');
						}
					}

					/* Verifying field/id unicity
					* For each added field, check unicity for that field
					* For each removed field,... well there is nothing to do...
					*/


					nextNode();
				}

				function nextNode(){
					if (indexNodeIterator.hasNext()){
						indexNodeIterator.next(function(err, _n){
							if (err){
								cb(err);
								return;
							}

							currentNode = _n;
							processNode();
						});
					} else {
						cb(undefined, offendingDocsCount === 0, offendingDocs);
					}
				}

				nextNode();

				/*function checkMapFn(indexedDoc, emit){
					if (!indexedDoc.index) return; //The doc has no index data -> nothing to validate -> next doc

					var validationResult = validateIndexAgainstModel(indexedDoc.index, indexModel);
					if (validationResult){
						emit({})
						return;
					}
				}

				collectionIndex.map(checkMapFn, cb);*/
			};

			this.save = function(doc, cb, overwrite, ttl, doNotWriteIndex){
				if (typeof cb != 'function') throw new TypeError('callback must be a function');

				var blobAndIndex;
				try {
					blobAndIndex = docToBlobAndIndex(doc);
				} catch (e){
					cb(e);
					return;
				}

				self.__save(blobAndIndex.b, blobAndIndex.i, cb, overwrite, blobAndIndex.t || ttl, doNotWriteIndex);
			};

			this.__save = function(blob, index, cb, overwrite, ttl, doNotWriteIndex){
				if (typeof cb != 'function') throw new TypeError('callback must be a function');
				var fileData, indexData, docId, docIndexObj, serializedDocIndexObj;
				//If not blob, just save index data
				var noBlob = false;
				var tb = typeof blob;
				var blobType;
				if (tb == 'string'){
					fileData = blob;
					blobType = 'string'
				} else if (blob instanceof Uint8Array){
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

					if (collectionIndexModel){
						//Validation of index data against the model
						var validationResult = validateIndexAgainstModel(indexData, collectionIndexModel);
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
						var indexFields = Object.keys(collectionIndexModel);
						var idField = null, uniqueFields = [];
						for (var i = 0; i < indexFields.length; i++){
							if (collectionIndexModel[indexFields[i]].id){
								if (!idField) idField = indexFields[i];
							}
							if (collectionIndexModel[indexFields[i]].unique){
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

						var uniqueId;
						if (docId){
							checkIdIsUnique(docId, function(err, isUnique){
								if (err){
									cb(err);
									return;
								}

								uniqueId = isUnique;

								if (docId && !uniqueId){
									if (overwrite){
										removeDoc(docId, function(err){
											if (err){
												cb(err);
												return;
											}

											checkFieldsUnicity();
										});
									} else {
										cb('DUPLICATE_ID');
									}
								} else {
									save();
								}
							});
						} else {
							//If there are `unique` fields or marked as `id`, then check for unicity before saving the doc
							if ((docId && uniqueId) || uniqueFields.length > 0) checkFieldsUnicity();
							else save(); //Otherwise, save the doc now
						}

						function checkFieldsUnicity(){
							var fieldIndex = 0;

							function checkOneField(){
								checkFieldIsUnique(uniqueFields[fieldIndex], indexData[fieldIndex], function(err, isUnique){
									if (err){
										cb(err);
										return;
									}
									if (!isUnique){
										cb('DUPLICATE_UNIQUE_VALUE');
										return;
									}
									nextField();
								});
							}

							function nextField(){
								fieldIndex++;
								if (uniqueFields.length == fieldIndex) save();
								else checkOneField();
							}

							checkOneField();
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

			this.bulkSave = function(docs, cb, overwrite, ttl){
				if (typeof cb != 'function') throw new TypeError('cb must be a function');
				if (!(docs && Array.isArray(docs) && docs.length > 0)){
					cb(new TypeError('docs must be a non-empty array'));
					return;
				}

				var indices = new Array(docs.length);
				var blobs = new Array(docs.length);
				var ttlArray = new Array(docs.length);

				for (var i = 0; i < docs.length; i++){
					var blobAndIndex;
					try {
						blobAndIndex = docToBlobAndIndex(docs[i]);
					} catch (e){
						cb(e);
						return;
					}
					blobs[i] = blobAndIndex.b;
					indices[i] = blobAndIndex.i;
					ttlArray[i] = blobAndIndex.t || ttl;
				}

				self.__bulkSave(blobs, indices, cb, overwrite, ttlArray);
			};

			this.__bulkSave = function(blobs, indices, cb, overwrite, ttl){
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
				var _saveIndex = 0;
				var isLast = false;
				function saveOne(){
					self.__save(blobs ? blobs[_saveIndex] : undefined, indices ? indices[_saveIndex] : undefined, function(err, docId){
						if (err){
							cb(err);
							return;
						}
						docIDs.push(docId);
						next();
					}, overwrite, ttl ? ttl[_saveIndex] : undefined, !isLast); //Write index only when the last doc is inserted
				}

				function next(){
					_saveIndex++;
					if (_saveIndex == dataLength - 1) isLast = true;
					if (_saveIndex == dataLength) cb(undefined, docIDs);
					else {
						if (_saveIndex % 100 == 0) setTimeout(saveOne, 0);
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

				retrieveIndexDocsMatchingQuery(q, undefined, undefined, undefined, function(err, matchedDocs){
					if (err){
						callback(err);
						return;
					}

					if (matchedDocs.length == 0){ //No docs to be updated
						callback(undefined, 0);
						return;
					}

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
								if (collectionIndexModel){
									var validatedIndexData = validateIndexAgainstModel(newIndexData, collectionIndexModel);
									if (typeof validatedIndexData == 'string' || !validatedIndexData){
										next('INVALID_INDEX_DATA');
										return;
									}
									newIndexData = validatedIndexData;

									//Extracted supposed id and unique fields
									var indexFields = Object.keys(collectionIndexModel);
									var idField = null, uniqueFields = [];
									for (var i = 0; i < indexFields.length; i++){
										if (collectionIndexModel[indexFields[i]].id){
											if (!idField) idField = indexFields[i];
										}
										if (collectionIndexModel[indexFields[i]].unique){
											uniqueFields.push(indexFields[i]);
										}
									}

									//Check that the id didn't change with the new data
									if (idField && newIndexData[idField] != indexData[idField]){
										next('ID_CHANGE_FORBIDDEN');
										return;
									}

									//Checking fields unicity
									var fieldUnicityIndex = 0;

									function checkOneField(){
										checkFieldIsUnique(uniqueFields[fieldUnicityIndex], newIndexData[fieldUnicityIndex], function(err, isUnique){
											if (err){
												next(err);
												return;
											}
											if (!isUnique){
												next('DUPLICATE_UNIQUE_VALUE');
												return;
											}
											nextField();
										});
									}

									function nextField(){
										fieldUnicityIndex++;
										if (uniqueFields.length == fieldUnicityIndex) save();
										else checkOneField();
									}

									checkOneField();
								} else save();

								function save(){
									saveDoc(docId, blobData, newIndexData, 'json', collectionTTLs && collectionTTLs[docId], next)
								}
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
				});
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

				if (typeof q == 'string'){
					readDoc(q, function(err, r){
						cb(err, [r]);
					});
					return;
				}

				//If not blob, just return index data
				retrieveIndexDocsMatchingQuery(q, limit, undefined, undefined, function(err, results){
					if (err){
						cb(err);
						return;
					}

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
				});
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

				retrieveIndexDocsMatchingQuery(q, limit, undefined, undefined, function(err, results){
					if (err){
						cb(err);
						return;
					}

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
				});
			};

			this.count = function(q, cb){
				if (!q) throw new TypeError('count query is missing');
				if (typeof cb != 'function') throw new TypeError('cb must be a function');

				retrieveIndexDocsMatchingQuery(q, undefined, undefined, undefined, function(err, results){
					cb(err, results.length);
				});

				/*if (q){
					if (typeof q == 'string') return documentsIndex.documents[q] ? 1 : 0;
					if (typeof q != 'object') throw new TypeError('when defined, q must either be a string or an object');
					var results = applyQuery(q, documentsIndex.documents);
					return results.length;
				} else return documentsIndex.docCount;*/
			};

			/*this.size = function(cb){
				if (cb && typeof cb != 'function') throw new TypeError('when defined, callback must be a function');

				var currentCollectionSize = collectionIndexSize + documentsIndex.collectionSize;
				if (cb) cb(undefined, currentCollectionSize);
				else return currentCollectionSize;
			};*/

			this.getTTL = function(q, cb){
				if (!(typeof q == 'string' || typeof q == 'object')) throw new TypeError('q must either be a string or an object');
				if (typeof cb != 'function') throw new TypeError('cb must be a function');

				retrieveIndexDocsMatchingQuery(q, undefined, undefined, undefined, function(err, results){
					if (err){
						cb(err);
						return;
					}

					if (results.length == 0){ //If no matched documents, just pass the empty array "to prove it"
						if (cb) cb(undefined, results);
						else return results;
					}

					getTTLForId(results.map(function(d){return d.id}), function(ttls){
						cb(undefined, ttls);
					});
				});
			};

			this.setTTL = function(q, ttl, cb){
				if (!(typeof q == 'string' || typeof q == 'object')) throw new TypeError('q must either be a string or an object');
				if (!(ttl == null || typeof ttl == 'undefined' || typeof ttl == 'number' || ttl instanceof Date)) throw new TypeError('ttl must either be null/undefined or a number or a Date instance');
				if (typeof ttl == 'number' && !(Math.floor(ttl) == ttl)) throw new TypeError('when ttl is a number, it must be an integer');
				if (ttl instanceof Date) ttl = ttl.getTime();
				if (typeof cb != 'function') throw new TypeError('cb must be a function');

				retrieveIndexDocsMatchingQuery(q, undefined, undefined, undefined, function(err, ttlDocs){
					if (err){
						cb(err);
						return;
					}


					if (!ttlDocs || ttlDocs.length == 0){ //No docs mathed by the query, so no TTL to set/update
						cb();
						return;
					}

					if (ttl > 0 && ttl < Date.now()) ttl = ttl + Date.now();

					setTTLForId(ttlDocs.map(function(d){return d.id}), ttl, cb);
				});
			};

			this.close = function(){
				if (purgeInterval){
					clearInterval(purgeInterval);
					purgeInterval = null;
				}
				k = null;
			};

			function saveMetaIndex(cb){
				if (typeof cb != 'function') throw new TypeError('callback must be a function');

				//if (!k) k = sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, rootKey, from_hex(collectionDescription.salt));
				if (!k) k = from_hex(collectionDescription.key);

				var metaIndexStr = JSON.stringify(collectionMeta);

				cryptoFileEncoding.encrypt(from_string(metaIndexStr), k, function(err, metaIndexCipher){
					if (err){
						cb(err);
						return;
					}

					metaIndexCipher = checkWriteBuffer(metaIndexCipher);

					fs.writeFile(metaFilePath, metaIndexCipher, cb);
				});
			}

			function getIndexFileName(r){
				return '_index_' + to_hex(longToBufferBE(r.start)) + '_' + to_hex(longToBufferBE(r.end));
			}

			function retrieveIndexDocsMatchingQuery(query, limit, matchFunction, includePureBlobs, cb){

				/*if (typeof query == 'string'){
					//Lookup by id;
					collectionIndex.lookup(query, function(err, matchedDoc){
						if (matchedDoc) matchedDoc.id = query;
						cb(err, [matchedDoc]);
					});
					return;
				}*/

				//Ignore sorting, as this will be done by the function calling this one (i.e : find or findOne)
				query = query && shallowCopy(query);

				var sortAndSkipQuery;
				if (query && (query.$sort || query.$skip)){
					sortAndSkipQuery = {$sort: query.$sort, $skip: query.$skip};
					delete query.$sort;
					delete query.$skip;
				}

				var resultSet = [];

				function mapFn(subset, countResult){
					var partialResult = applyQuery(query, subset, undefined, matchFunction, includePureBlobs);
					Array.prototype.push.apply(resultSet, partialResult);
				}

				collectionIndex.map(mapFn, function(err){
					if (err){
						cb(err);
						return;
					}

					cb(undefined, sortAndSkipQuery ? applyQuery(sortAndSkipQuery, resultSet, limit, includePureBlobs) : resultSet);
				}, limit, true); //true : forQuery. Passes entire leaf data without clone
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
				collectionIndex.lookup(id, function(err, docToDelete){
					if (err){
						cb(err);
						return;
					}

					if (!docToDelete){
						cb();
						return;
					}

					if (docToDelete.k){
						//Docs that have a blob also have a k attribute, that holds the encryption key.
						//If no k attribute can be found, then there is no blob associated to the doc
						var blobFilePath = pathJoin(collectionPath, id);
						if (docToDelete.size) collectionMeta.collectionBlobSize -= docToDelete.size;

						fs.unlink(blobFilePath, function(err){
							if (err) cb(err);
							else {
								saveMetaIndex(function(err){
									if (err) console.error('Cannot save _meta file for collection ' + collectionName + ': ' + err);
									removeFromIndex();
								});
							}
						})
					} else {
						removeFromIndex();
					}
				});

				function removeFromIndex(){
					collectionIndex.remove(id, undefined, cb, doNotSaveIndex); //doNotSaveIndex == noTrigger
				}
			}

			function saveDoc(docId, fileData, indexData, blobType, ttl, cb, doNotWriteIndex){
				var docIndexObj;
				prepareIndex(function(err){
					if (err) cb(err);
					else saveBlob(cb);
				});

				function saveBlob(_cb){
					if (!fileData){
						insertInIndex();
						return;
					}
					var docFilePath = pathJoin([rootPath, collectionName, docId]);

					var docKey = randomBuffer(sodium.crypto_secretbox_KEYBYTES);
					var docNonce = randomBuffer(sodium.crypto_secretbox_NONCEBYTES);

					var dataBuffer;
					if (fileData instanceof Uint8Array) dataBuffer = fileData;
					else dataBuffer = from_string(fileData);
					//console.log('Encrypting blob');
					doSecretBox(dataBuffer, docNonce, docKey, function(err, encryptedFileData){
						if (err){
							_cb(err);
							return;
						}

						//var finalFileData = to_base64(concatBuffers([docNonce, encryptedFileData]), true);
						var finalFileData = concatBuffers([docNonce, encryptedFileData]);
						//console.log('Blob encrypted');
						docIndexObj.k = to_base64(docKey, true);
						//Updating DB size calculation
						docIndexObj.size = finalFileData.length;

						collectionMeta.collectionBlobSize += finalFileData.length;

						fs.unlink(docFilePath, function(err){ //Deleting the blob file, if there is one. Basically, ensuring an overwrite
							if (err && !(err.code && typeof err.code == 'string' && err.code == 'ENOENT')){ //If there is an error, and it's not because a file doesn't exists : pass error through callback
								_cb(err);
								return;
							}
							fs.writeFile(docFilePath, checkWriteBuffer(finalFileData), function(err){
								if (err) _cb(err);
								else {
									saveMetaIndex(function(err){
										if (err) console.error('Error while saving _meta for collection ' + collectionName + ': ' + err);
									});
									insertInIndex();
								}
							});
						});
					});
				}

				function prepareIndex(_cb){
					//If a docId is provided, use it (it may overwrite an existing doc, but we've checked that before). Otherwise, generate one

					if (!docId){
						//Generating doc IDs until we get a unique one. Note that if the docId has been provided by the user, it has been checked for unicity earlier
						function tryId(){
							docId = to_hex(randomBuffer(8));
							checkIdIsUnique(docId, function(err, isUnique){
								if (err){
									_cb(err);
									return;
								}

								if (isUnique) afterIdValidation();
								else tryId();
							});
						}

						tryId();
					} else afterIdValidation();

					function afterIdValidation(){
						var ttlData;
						if (ttl){
							if (ttl < Date.now()) ttlData = ttl + Date.now();
							else ttlData = ttl;
						}

						docIndexObj = {
							index: indexData,
							blobType: blobType
						};

						if (ttlData){
							setTTLForId(docId, ttlData, function(err){
								if (err){
									_cb(err);
									return;
								}

								proceedToSave();
							});
						} else proceedToSave();

						function proceedToSave(){
							if (fileData) _cb();
							else insertInIndex();
						}
					}
				}

				function insertInIndex(){
					collectionIndex.add(docId, docIndexObj, function(err){
						cb(err, docId);
					}, doNotWriteIndex, true);
				}
			}

			function readDoc(idOrDoc, cb){
				var doc;
				var docId;

				if (typeof idOrDoc == 'string'){
					collectionIndex.lookup(idOrDoc, function(err, _doc){
						if (err){
							cb(err);
							return;
						}

						if (!_doc){
							cb();
							return;
						}

						doc = _doc;
						docId = idOrDoc;
						afterLookup();
					});
				} else if (typeof idOrDoc == 'object'){
					doc = idOrDoc;
					docId = doc.id;
					afterLookup();
				} else {
					throw new TypeError('Invalid idOrDoc reference type: ' + typeof idOrDoc);
				}

				function afterLookup(){
					if (doc.k){
						var docFilePath = pathJoin([rootPath, collectionName, docId]);
						fsExists(docFilePath, function(blobExists){
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
								var fileDataBuffer = checkReadBuffer(data);
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

								doSecretBoxOpen(cipherBuffer, nonceBuffer, from_base64(doc.k), function(err, decryptedBlob){
									if (err){
										//console.error('While decrypting blob');
										//console.error(err);
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
								});
							});
						});
					} else cb(undefined, clone(doc.index));
				}
			}

			function ttlCheckAndPurge(cb){
				if (cb && typeof cb != 'function') throw new TypeError('when defined, cb must be a function');

				if (collectionTTLs == -1){
					if (cb) cb();
					return; //No TTLs for this collection
				}

				//This code segment is to be executed typically when loading the collection
				if (!collectionTTLs){
					loadTTLs(function(err){
						if (err){
							if (cb) cb();
							else throw err;
							return;
						}

						if (collectionTTLs == -1){
							if (cb) cb();
							return; //No TTLs for this collection
						}

						runPurge();
					});
				} else runPurge();

				function runPurge(){
					if (purgeOngoing) return;
					purgeOngoing = true;
					var n = Date.now();

					var docsToDelete;

					var docsList = Object.keys(collectionTTLs);
					for (var i = 0; i < docsList.length; i++){
						var ttlVal = collectionTTLs[docsList[i]];
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

							delete collectionTTLs[currentDocId];

							docIndex++;
							if (docIndex == docsToDelete.length){
								collectionTTLsChanged = false;
								purgeOngoing = false;

								saveTTLs(function(err){
									if (err && !cb) throw err;
									if (cb) cb(err);
								});
							} else {
								//Chain doc deletions
								if (docIndex % 100 == 0) setTimeout(deleteOne, 0);
								else deleteOne();
							}
						}, docIndex < docsToDelete.length - 1); //Do not save doc index after deleting one doc, but rather after deleting all expired docs
					}

					if (docsToDelete) deleteOne();
					else if (collectionTTLsChanged){
						saveTTLs(function(err){
							collectionTTLsChanged = false;
							purgeOngoing = false;

							if (err && !cb) throw err;
							if (cb) cb();
						});

					}
					else {
						purgeOngoing = false;
						if (cb) cb();
					}
				}
			}

			function setTTLForId(id, ttl, cb){
				if (!collectionTTLs){ //Waiting for the purging system to load the TTLs file
					loadTTLs(function(err){
						if (err){
							if (cb) cb(err);
							else throw err;
							return;
						}

						performSet();
					});
				} else performSet();

				function performSet(){
					if (collectionTTLs == -1){
						collectionTTLs = {};
					}

					if (Array.isArray(id)){
						for (var i = 0; i < id.length; i++){
							collectionTTLs[id[i]] = ttl;
						}
					} else collectionTTLs[id] = ttl;

					collectionTTLsChanged = true;

					if (cb) cb();
				}
			}

			function getTTLForId(id, cb){
				if (!collectionTTLs){ //Waiting for the purging system to load the TTLs file
					loadTTLs(function(err){
						if (err){
							cb(err);
							return;
						}

						performGet();
					});
				} else performGet();

				function performGet(){
					if (collectionTTLs == -1) cb();
					else {
						if (Array.isArray(id)){
							var r = {};
							for (var i = 0; i < id.length; i++){
								r[id[i]] = collectionTTLs[id[i]];
							}
							cb(r);
						} else cb(collectionTTLs[id]);
					}
				}
			}

			function saveTTLs(cb){
				if (typeof cb != 'function') throw new TypeError('callback must be a function');

				if (!collectionTTLs){
					cb();
					return;
				}

				if (!k) k = from_hex(collectionDescription.key);

				var ttlsStr = JSON.stringify(collectionTTLs);

				cryptoFileEncoding.encrypt(from_string(ttlsStr), k, function(err, ttlsCipher){
					if (err){
						cb(err);
						return;
					}

					ttlsCipher = checkWriteBuffer(ttlsCipher);

					fs.writeFile(ttlsFilePath, ttlsCipher, cb);
				});
			}

			function loadTTLs(cb){
				if (typeof cb != 'function') throw new TypeError('cb must be a function');

				fsExists(ttlsFilePath, function(ttlsExist){
					if (!ttlsExist){
						collectionTTLs = -1;
						cb();
						return;
					} else {
						fs.readFile(ttlsFilePath, function(err, data){
							if (err){
								cb(err);
								return;
							}

							var ttlsCipher = checkReadBuffer(data);

							cryptoFileEncoding.decrypt(ttlsCipher, k, function(err, ttlsBuffer){
								if (err){
									console.error('Cannot decrypt TTLs list for collection ' + collectionName + ': ' + err);
									cb('INVALID_ROOTKEY');
									return;
								}

								try {
									collectionTTLs = JSON.parse(to_string(ttlsBuffer));
								} catch (e){
									cb('INVALID_TTLS');
									return;
								}

								cb();
							});
						});
					}
				});
			}

			function checkIdIsUnique(id, cb){
				if (!cb) throw new Error('Missing callback');

				collectionIndex.lookup(id, function(err, v){
					cb(err, !v);
				});
			}

			/**
			* Check that the a given value for a given field is unique across the collection (either before or after insertion of the document that contains this value)
			* @param {String} fieldName
			* @param value - the value for which we are testing unicity
			* @param {Function} cb - callback function, receives (err, isUnique)
			* @param {Boolean} [postInsert] - defaults to false ; a parameter that indicates whether this unicity test is done before inserting the document that contain the value (expecting matchingDocIds.length == 0) or afterwards (expecting matchingDocIds.length <= 1)
			*/
			function checkFieldIsUnique(fieldName, value, cb, postInsert){
				if (!cb) throw new TypeError('Missing callback');

				//If there is an index for that field, check existence of value in index
				if (searchIndices[fieldName]){
					searchIndices[fieldName].lookup(value, function(err, matchingDocIds){
						if (err){
							cb(err);
							return;
						}

						cb(undefined, matchingDocIds.length <= (postInsert ? 1 : 0));
					});
				} else {
					function mapUnicitiyCheckFn(doc, emit){
						if (doc.index[fieldName] == value) emit(doc.id);
					}

					collectionIndex.map(mapUnicitiyCheckFn, function(err, matchedDocs){
						cb(err, matchedDocs.length <= (postInsert ? 1 : 0));
					}, 1); //Limit the "map search" to one result
				}
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

		/**
		* Returns validated model object, or the name of a failing field
		* Note that this method modifies models where there are fields that are described
		* by a simple string (e.g : {fieldName: 'fieldType'} is transformed to {fieldName: {type: 'fieldType'}})
		*
		*/
		function validateIndexModel(model){
			// {name, type, unique, id}
			var fieldNames = Object.keys(model);
			var idField;
			for (var i = 0; i < fieldNames.length; i++){
				var fieldName = fieldNames[i];

				if (!isFieldName(fieldName)) return 'INVALID_FIELD_NAME_FORMAT:' + fieldName;

				var fieldDescription = model[fieldName];

				if (typeof fieldDescription == 'string'){
					fieldDescription = {type: fieldDescription};
				} else if (typeof fieldDescription == 'object' && Object.keys(fieldDescription).length > 0){
					//Removing unwanted attributes. Keep what we want
					fieldDescription = {type: fieldDescription.type, id: fieldDescription.id, unique: fieldDescription.unique};
				} else {
					//Invalid field description
					return 'INVALID_FIELD_DESCRIPTION:' + fieldName;
				}

				if (!isType(fieldDescription.type)) return 'INVALID_FIELD_TYPE:' + fieldName + '(' + fieldDescription.type + ')';

				if (fieldDescription.id){
					if (idField) return 'ID_FIELD_CONFLICT:' + idField + 'vs' + fieldName; //An ID field already exists
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

	//Serializing date and buffer values to string, and preventing mix-up with strings
	function serializeObject(o){
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
				o[objAttributes[i]] = '$s:' + currentValue;
				continue;
			}
			if (currentValue instanceof Date){
				o[objAttributes[i]] = '$d:' + currentValue.getTime();
				continue;
			}
			if (currentValue instanceof Uint8Array){
				o[objAttributes[i]] = '$b:' + to_string(currentValue);
				continue;
			}
		}
		return o;
	}

	//Deserializing date and buffer values
	function deserializeObject(o){
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
				if (currentValue.indexOf('$d:') == 0 || currentValue.indexOf('$date:') == 0){
					if (currentValue.indexOf('$d:') == 0) currentValue = currentValue.substring('$d:'.length);
					else currentValue = currentValue.substring('$date:'.length);

					currentValue = Number(currentValue);
					if (isNaN(currentValue)){
						cb('INVALID_DATE_FORMAT');
						return;
					}
					currentValue = new Date(currentValue);
				} else if (currentValue.indexOf('$s:') == 0 || currentValue.indexOf('$string:') == 0){
					if (currentValue.indexOf('$s:') == 0) currentValue = currentValue.substring('$s:'.length);
					else currentValue = currentValue.substring('$string:'.length);
				} else if (currentValue.indexOf('$b:') == 0 || currentValue.indexOf('$buffer:')){
					if (currentValue.indexOf('$b:') == 0) currentValue = from_string(currentValue.substring('$b:'.length));
					else currentValue = from_string(currentValue.substring('$buffer:'.length));
				}
				o[objAttributes[i]] = currentValue;
			}
		}
		return o;
	}

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
		} else return o;
	}
	exports.clone = clone;

	/*
	* Shallow copy of an object.
	*/
	function shallowCopy(source, target){
		if (typeof source != 'object') return source;
		if (target && typeof target != 'object') throw new TypeError('when defined, target must be an object');

		if (Array.isArray(source)){
			var c;
			if (target){
				if (!Array.isArray(target)) throw new TypeError('if source is an array, then target must also be an array');
				c = target;
				for (var i = 0; i < source.length; i++){
					if (i < c.length) c[i] = source[i];
					else c.push(source[i]);
				}
			} else {
				var c = new Array(source.length);
				for (var i = 0; i < source.length; i++) c[i] = source[i];
			}
			return c;
		} else {
			var c = target || {};
			var sourceAttr = Object.keys(source);
			for (var i = 0; i < sourceAttr.length; i++) c[sourceAttr[i]] = source[sourceAttr[i]];
			return c;
		}
	}

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
	* 1 byte : file/db format version number
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

	function scryptFileEncode(buffer, key, callback, salt, opsLimit, r, p, fileFormatVersion){
		if (!(buffer && buffer instanceof Uint8Array)) throw new TypeError('Buffer must be a Uint8Array');
		if (!(typeof key == 'string' || key instanceof Uint8Array)) throw new TypeError('key must be a string or a Uint8Array buffer');
		if (salt && !((typeof salt == 'string' || salt instanceof Uint8Array))) throw new TypeError('salt must be a string or a Uint8Array buffer');

		if (key.length != sodium.crypto_secretbox_KEYBYTES) throw new TypeError('key must be 32 bytes long');
		if (typeof key == 'string') key = from_string(key);

		if (typeof callback != 'function') throw new TypeError('callback must be a function');

		//Default Scrypt parameters
		opsLimit = opsLimit || 16384;
		r = r || 8;
		p = p || 1;

		fileFormatVersion = fileFormatVersion || 0x01;

		if (!(typeof opsLimit == 'number' && Math.floor(opsLimit) == opsLimit && opsLimit > 0)){
			callback(new TypeError('when defined, opsLimit must be a strictly positive integer number'));
			return;
		}
		if (!(typeof r == 'number' && Math.floor(r) == r && r > 0)){
			callback(new TypeError('when defined, r must be a strictly positive integer number'));
			return;
		}
		if (!(typeof p == 'number' && Math.floor(p) == p && p > 0)){
			callback(new TypeError('when defined, p must be a strictly positive integer number'));
			return;
		}

		if (!(typeof fileFormatVersion == 'number' && Math.floor(fileFormatVersion) == fileFormatVersion && fileFormatVersion >= 0 && fileFormatVersion <= 255)){
			callback(new TypeError('when provided, fileFormatVersion must be a byte'));
			return;
		}

		var saltSize = (salt && salt.length) || 0;
		var nonceSize = sodium.crypto_secretbox_NONCEBYTES;
		var totalSize = 17 + saltSize + nonceSize + buffer.length + sodium.crypto_secretbox_MACBYTES;

		var b = new Uint8Array(totalSize);
		var bIndex = 0;

		//Writing file/db format version number
		b[bIndex] = fileFormatVersion;
		bIndex++;
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
		doSecretBox(buffer, nonce, key, function(err, cipher){
			if (err){
				callback(err);
				return;
			}

			for (var i = 0; i < cipher.length; i++){
				b[bIndex+i] = cipher[i];
			}
			bIndex += cipher.length;

			callback(undefined, b);
		});
	}

	function scryptFileDecode(buffer, key, headerData, callback){
		if (typeof callback != 'function') throw new TypeError('callback must be a function');

		if (!(buffer && buffer instanceof Uint8Array)){
			callback(new TypeError('Buffer must be a Uint8Array'));
			return;
		}
		if (!(typeof key == 'string' || key instanceof Uint8Array)){
			callback(new TypeError('key must be a string or a Uint8Array buffer'));
			return;
		}

		try {
			headerData = headerData || scryptFileDecodeHeader(buffer);
		} catch (e){
			callback(e);
			return;
		}

		if (typeof headerData != 'object'){
			callback(new TypeError('headerData must be an object'));
			return;
		}

		if (typeof key == 'string') key = from_string(key);

		doSecretBoxOpen(headerData.cipher, headerData.nonce, key, function(err, plainText){
			if (err){
				callback('INVALID_ROOTKEY');
				return;
			}

			callback(undefined, plainText);
		});
	}

	function scryptFileDecodeHeader(buffer){
		if (!(buffer && buffer instanceof Uint8Array)) throw new TypeError('buffer must be a Uint8Array buffer');

		var minRemainingSize = 17; //17 bytes from the above format description

		if (in_avail() < minRemainingSize) throw new RangeError('Invalid encrypted buffer format');

		var fileFormatVersion = 0;
		var r = 0, p = 0, opsLimit = 0, saltSize = 0, nonceSize = 0, encBufferSize = 0;
		var opsLimitBeforeException = 4194304;
		var rIndex = 0;

		//Reading file format version number
		fileFormatVersion = buffer[rIndex];
		rIndex++;
		minRemainingSize--;

		if (!(fileFormatVersion == 0x00 || fileFormatVersion == 0x01)) throw new Error('Unsupported file format version: ' + fileFormatVersion + '. Please use a newer version of Lawncipher');

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
		var salt = saltSize > 0 ? new Uint8Array(saltSize) : undefined;
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

		return {fileFormatVersion: fileFormatVersion, r: r, p: p, N: opsLimit, salt: salt, nonce: nonce, cipher: cipherText};

		function in_avail(){return buffer.length - rIndex;}
	}

	function scryptCheckFileHeader(fh){
		if (typeof fh != 'object') throw new TypeError('fileHeader must be an object');
		checkByte(fh.fileFormatVersion, 'fileHeader.fileFormatVersion');
		checkUInt(fh.r, 'fileHeader.r');
		checkUInt(fh.p, 'fileHeader.p');
		checkUInt(fh.N, 'fileHeader.N');
		checkBuffer(fh.salt, 'fileHeader.salt');
		checkBufferWithLength(fh.nonce, sodium.crypto_secretbox_NONCEBYTES, 'fileHeader.nonce');
		checkBuffer(fh.cipher, 'fileHeader.cipher');
	}

	function checkByte(n, varName){
		if (!(typeof n == 'number' && Math.floor(n) == n && n >= 0 && n <= 255)) throw new TypeError(varName + ' must be an unsigned byte');
	}

	function checkUInt(n, varName){
		if (!(typeof n == 'number' && Math.floor(n) == n && n >= 0)) throw new TypeError(varName + ' must be an unsigned integer number');
	}

	function checkBuffer(b, varName){
		if (!(b instanceof Uint8Array && b.length > 0)) throw new TypeError(varName + ' must be a buffer (Uint8Array)');
	}

	function checkBufferWithLength(b, bLength, varName){
		if (!(b instanceof Uint8Array && b.length == bLength)) throw new TypeError(varName + ' must be a buffer (Uint8Array), that is ' + bLength + ' bytes long');
	}

	function checkStringArray(a, varName, disallowEmpty){
		if (!Array.isArray(a)) throw new TypeError(varName + ' must be an array');
		if (disallowEmpty && a.length == 0) throw new TypeError(varName + ' cannot be empty');

		for (var i = 0; i < a.length; i++) if (typeof a[i] != 'string') throw new TypeError(varName + '[' + i + '] must be a string');
	}

	function checkSubCollection(subCollection, varName){
		/*if (typeof subCollection != 'object') throw new TypeError(varName + ' must be an object');
		var docList = Object.keys(subCollection);
		for (var i = 0; i < docList.length; i++){
			if (!(checkDocIndexObj(subCollection[docList[i]]) || Array.isArray(subCollection[docList[i]]))){
				console.error('Invalid subCollection element [' + docList[i] + ']: ' + JSON.stringify(subCollection[docList[i]]));
			}
		}*/
	}

	function checkDocIndexObj(o){
		return typeof o == 'string' && (typeof o.index == 'object'|| typeof o.blobType == 'string');
	}

	function copyBuffer(b){
		checkBuffer(b, 'b');
		var bCopy = new Uint8Array(b.length);
		for (var i = 0; i < b.length; i++) bCopy[i] = b[i];
		return bCopy;
	}

	function Index(rootPath, collectionName, indexName, collectionKey, pearsonSeed, loadCallback, _maxLoadedDataSize, _maxNodeSize, _booleanMode, _uniqueIndex){
		if (!(typeof collectionName == 'string' && collectionName.length > 0)) throw new TypeError('collectionName must be a non-empty string');
		if (!(typeof indexName == 'string' && indexName.length > 0)) throw new TypeError('indexName must be a non-empty string');
		if (!(collectionKey instanceof Uint8Array && collectionKey.length == 32)) throw new TypeError('collectionKey must be a 32-byte Uint8Array');
		if (!(Array.isArray(pearsonSeed) && pearsonSeed.length == 256)) throw new TypeError('pearsonSeed must be an array containing a permutation of integers in the range [0; 255]');
		if (typeof loadCallback != 'function') throw new TypeError('loadCallback must be a function');
		if (_maxLoadedDataSize && !(typeof _maxLoadedDataSize == 'number' && Math.floor(_maxLoadedDataSize) == _maxLoadedDataSize) && _maxLoadedDataSize > 0) throw new TypeError('when defined, _maxLoadedDataSize must be a strictly positive integer');
		if (_maxNodeSize && !(typeof _maxNodeSize == 'number' && Math.floor(_maxNodeSize) == _maxNodeSize && _maxNodeSize > 0)) throw new TypeError('when defined, _maxNodeSize must be a strictly positive integer');

		var self = this;

		var collectionPath = rootPath ? pathJoin(rootPath, collectionName) : collectionName;

		//If indexName == 'index' or '_index', meaning that this index is central collection
		//Else, this index is an attribute search index. Hence, nodes may have to allow multiple values for a given key
		var isCollectionIndex = (indexName == 'index');
		var disallowKeyCollisions = isCollectionIndex || _uniqueIndex;

		var fragmentNameMatcher = indexNameRegexBuilder(indexName); //Fragment filename validation RegExp instance
		var fragmentNameBuilder = indexNameBuilder(indexName); //Fragment filename builder function. Takes the dataRange (a PearsonRange instance) of the fragment in question

		//Array<PearsonRange>. To be updated on Index instanciation, fragment change and delete events
		var fragmentsList = [];
		/*
		*	Load state variables
		*/

		//Sum of currentLoadedFragmentsSize
		var currentDataLoad = 0;

		/*
			Hash<PearsonRangeStr, fragmentPlaintextSize>.
			Contains the plaintext size (in bytes) of each index fragment,
			by rangeStr. To be used to calculate and updated currentDataLoad.
			Also to be used to check the "loaded" state of a given fragment,
			if we assume that check the existence of a key in JS hash/object
			is faster than O(n) (i.e, the complexity of going through of
			currentLoadedFragmentsRange and checking each element)
		*/
		var currentLoadedFragmentsSize = {};

		/*
			Hash<PearsonRangeStr, PearsonRange>. Contains a subset of
			fragmentsList. To be used for operations on ranges. To
			check whether a given range r is loaded, checking the
			existence of currentLoadedFragmentsSize[r.toString()]
			might be faster and scale better (since
			currentLoadedFragmentsSize contains n whereas
			currentLoadedFragmentsRange contains objects)
		*/
		var currentLoadedFragmentsRange = {};

		/*
			The rough (inaccurate) memory usage threshold for the index,
			before it starts using dynamic data loading
			// 50MB = 50 * 1024 * 1024 = 52428800 ?? What default value should we assign to this??
		*/
		var maxDataLoad = _maxLoadedDataSize || 52428800;

		/*
			A "least recently used" string set, to keep track of which
			data range was least recently used and hence more appropriate
			to be removed from memory
		*/
		var fragmentsLRU = new LRUStringSet();

		var theHasher = PearsonHasher(pearsonSeed);
		var theTree = new PearsonBPlusTree(theHasher, _maxNodeSize || 53248, disallowKeyCollisions, _booleanMode); //Key collisions are disallowed on collection or "unique" searchIndex

		var hashToLong = function(s, isLookup){
			return bufferBEToLong(theHasher(s, isLookup), isLookup);
		};

		theTree.on('change', function(dRange, d){
			//Updated loaded ranges and ranges list
			dRange = PearsonRange.fromString(dRange);
			addRangeToFragmentsList(dRange);
			markUsageOf(dRange);
			saveIndexFragment(dRange, d);
		});

		theTree.on('delete', function(dRange){
			//Updated loaded ranges and ranges list
			dRange = PearsonRange.fromString(dRange);
			removeRangeFromFragmentsList(dRange);
			deleteIndexFragment(dRange)
		});

		fs.exists(collectionPath, function(dirExists){
			if (dirExists){
				fs.readdir(collectionPath, function(err, collectionDirList){
					if (err){
						loadCallback(err);
						return;
					}

					var fragmentCount = 0;
					for (var i = 0; i < collectionDirList.length; i++){
						var parsingState = fragmentNameMatcher.exec(collectionDirList[i]);
						//Skip the files that don't match the naming convention
						if (!parsingState) continue;

						if (parsingState.length > 1){
							fragmentCount++;
							addRangeToFragmentsList(PearsonRange.fromString(parsingState[1] + '_' + parsingState[2]));
						}
					}

					if (fragmentCount == 0){
						//No index fragments file has been found, despite an existing collection directory.
						//The only "range fragment" to be available is the full range.
						fragmentsList = [PearsonRange.MAX_RANGE];
						//When an index is created, and no index fragment is yet written, that's the only loaded range
						currentLoadedFragmentsRange[PearsonRange.MAX_RANGE.toString()] = PearsonRange.MAX_RANGE;
					}

					//console.log('Existing ranges: ' + Array.prototype.join.call(fragmentsList.map(function(v){return v.toString()}), ','));

					loadCallback();
				});
			} else {
				mkdirp(collectionPath, function(err){
					if (err){
						loadCallback(err);
						return;
					}

					//If no index file is found, well there is only one "range fragment" to be availabe : the full range
					fragmentsList = [PearsonRange.MAX_RANGE];
					loadCallback();
				});
			}
		});

		self.lookup = function(key, cb){
			if (typeof cb != 'function') throw new TypeError('cb must be a function');

			if (_booleanMode && typeof key != 'boolean'){
				cb(new TypeError('if _booleanMode == true, then key must be a boolean'));
				return;
			}
			//Key type check is done in hasher, so it's implicitly done in hashToLong
			var keyHash = theHasher(key, true);
			var keyHashLong = !Array.isArray(keyHash) ? bufferBEToLong(keyHash) : undefined;
			//var keyHash = hashToLong(key, true); //Lookup is on == true

			if (_booleanMode){
				//keyHash is an array of ranges
				//Tree lookup method must be able to take key ranges
				//And we should load unloaded ranges
				var keyHashIndex = 0;

				var matchedValues = [];

				function processOne(isLoaded){
					var currentSubRange = keyHash[keyHashIndex];
					if (isLoaded || isRangeLoaded(currentSubRange)){
						console.log('isLoaded(' + keyHashIndex + ')');
						var inTreeUnfilteredSubset = theTree.lookupRange(currentSubRange).getBinnedRange().subCollection;

						var inTreeSubset = [];

						var subsetKeys = Object.keys(inTreeUnfilteredSubset);
						for (var i = 0; i < subsetKeys.length; i++){
							var reversed = theHasher.reverseBoolean(subsetKeys[i]);
							if (reversed === key) inTreeSubset.push(inTreeUnfilteredSubset[subsetKeys[i]]);
						}

						for (var i = 0; i < inTreeSubset.length; i++){
							var currentVal = inTreeSubset[i];
							if (typeof currentVal == 'string') matchedValues.push(currentVal);
							else if (Array.isArray(currentVal)){
								for (var j = 0; j < currentVal.length; j++){
									matchedValues.push(currentVal[j]);
								}
							}
						}

						next();
					} else {
						console.log('loadIndexFragment(' + keyHashIndex + ')');
						loadIndexFragment(findRangeOfRange(currentSubRange), function(err){
							if (err){
								cb(err);
								return;
							}

							//Re-process the same subrange, now that it has been loaded
							processOne(true);
						});
					}
				}

				function next(){
					keyHashIndex++;
					if (keyHashIndex == keyHash.length) cb(undefined, matchedValues);
					else processOne();
				}

				processOne();

			} else {
				var inTreeValue = theTree.lookup(key, keyHashLong);

				/*
					If inTreeValue is defined, then we have found what we are looking for

					If it is not defined, then we have to check that the corresponding data
					range is loaded in memory. In case it is not loaded in memory, load it
					and lookup again.
				*/
				if (!inTreeValue && !isRangeOfHashLoaded(keyHashLong)){
					loadIndexFragmentForHash(keyHashLong, function(err){
						if (err){
							cb(err);
							return;
						}

						//Data range usage doesn't "need" to be marked in this case, because loadIndexFragmentForHash does it, through loadIndexFragment
						//console.log('keyHash:' + keyHash);
						inTreeValue = theTree.lookup(key, keyHashLong);
						cb(undefined, inTreeValue);
					});
				} else {
					markUsageOfHash(keyHashLong);
					cb(undefined, inTreeValue);
				}
			}
		};

		self.add = function(key, value, cb, noTrigger, replace){
			if (cb && typeof cb != 'function') throw new TypeError('when defined, cb must be a function');

			if (_booleanMode && typeof key != 'boolean'){
				cb(new TypeError('When _booleanMode == true, key must be a boolean'));
				return;
			}

			//We must check that the range that corresponds to the key is currently loaded
			//Key type check is done in hasher, so it's implicitly done in hashToLong
			var keyHash = theHasher(key);
			var keyHashLong = bufferBEToLong(keyHash);

			//Check that data range is loaded before performing the addition
			if (!isRangeOfHashLoaded(keyHashLong)){
				loadIndexFragmentForHash(keyHashLong, function(err){
					if (err){
						if (cb) cb(err);
						else throw err;
						return;
					}

					if (!_booleanMode){
						theTree.add(key, value, noTrigger, replace, keyHash);
					} else {
						theTree.add(to_hex(keyHash), value, noTrigger, replace, keyHash); //Use keyHash as hash (for data distribution) and storage (as identifier)
					}

					if (cb) cb();
				});
			} else {
				if (!_booleanMode){
					theTree.add(key, value, noTrigger, replace, keyHash);
				} else {
					theTree.add(to_hex(keyHash), value, noTrigger, replace, keyHash);
				}

				if (cb) cb();
			}
		};

		self.remove = function(key, value, cb, noTrigger){
			if (cb && typeof cb != 'function') throw new TypeError('when defined, cb must be a function');
			//We must check that the range that corresponds to the key is currently loaded
			//Key type check is done in hasher, so it's implicitly done in hashToLong

			//But we have to explicitly check that typeof key == 'boolean' if _booleanMode == true
			if (_booleanMode && typeof key != 'boolean'){
				var e = new TypeError('When _booleanMode == true, key must be a boolean');
				if (cb) cb(e);
				else throw e;
				return;
			}

			var keyHash = theHasher(key, true); //Lookup mode: on
			var keyHashLong = !Array.isArray(keyHash) ? bufferBEToLong(keyHash) : undefined;

			if (!_booleanMode){
				//Check that the data range is loaded before performing the removal
				if (!isRangeOfHashLoaded(keyHashLong)){
					loadIndexFragmentForHash(keyHashLong, function(err){
						if (err){
							if (cb) cb(err);
							else throw err;
							return;
						}

						theTree.remove(key, value, noTrigger, keyHash);
						if (cb) cb();
					});
				} else {
					theTree.remove(key, value, noTrigger, keyHash);
					if (cb) cb();
				}
			} else {
				//TODO: Use removeWithHash, in addition to the boolean special case where key = keyHash
				//Or should we perform a lookup, that returns us the stored hashes, that we then remove?

				//Iterate on each node of the tree
				var hashRanges = keyHash;
				var treeTraveler = self.nodeIterator();
				var currentNode;

				function processOne(){
					var currentDataSubset = currentNode.getBinnedRange('none');

					//For each node, build the list of subranges of the data to be deleted
					//These subranges to be deleted are removed from hashRanges, since you won't need them afterwards
					var currentRangesToDelete = [];
					for (var i = 0; i < hashRanges.length; i++){
						if (hashRanges[i].isContainedIn(currentDataSubset.range)){
							currentRangesToDelete.push(hashRanges[i]);
							hashRanges.splice(i, 1);
							i--;
						}
					}

					//For each of the node's key-value pair, if it is part of any of the "subranges to be deleted", delete it from the tree
					var currentHashesToDelete = [];
					var subCollectionKeys = Object.keys(currentDataSubset.subCollection);
					for (var i = 0; i < subCollectionKeys.length; i++){
						var currentHashLong = hexToLong(subCollectionKeys[i]);

						for (var j = 0; j < currentRangesToDelete.length; j++){
							if (currentRangesToDelete[j].contains(currentHashLong)){
								currentRangesToDelete.push(currentHashLong);
								break; //We found the right range. Get out of the range iteration loop
							}
						}
					}

					for (var i = 0; i < currentHashesToDelete.length; i++){
						//Remove the matched key-value pairs, by passing their hash upfront and triggering the tree event only if we are removing the last element of currentHashesToDelete
						theTree.remove(key, undefined, currentHashesToDelete.length - 1, currentHashesToDelete[i]);
					}

					nextNode();
				}

				function nextNode(){
					if (treeTraveler.hasNext()){
						treeTraveler.next(function(err, _n){
							if (err){
								if (cb) cb(err);
								else throw err;
								return;
							}

							currentNode = _n;
							processOne();
						});
					} else {
						if (cb) cb();
					}
				}

				nextNode();
			}
		};

		self.nodeIterator = function(){
			//throw new Error('Not yet implemented');

			function NodeIterator(){

				//Iterate over the fragments list
				var currentRange;

				var thisIterator = this;

				/*
				* This stateless tree traversal method is definitely not the most efficient way to do it
				*/
				this.next = function(cb){
					if (typeof cb != 'function') throw new TypeError('cb must be a function');

					if (!currentRange) currentRange = findRangeOfHash(PearsonRange.MAX_RANGE.start);
					else if (thisIterator.hasNext()){
						currentRange = findRangeOfHash(currentRange.end.add(1));
					} else {
						cb();
						return;
					}

					if (currentLoadedFragmentsRange[currentRange.toString()]){
						//The next range is already loaded in memory
						var currentNode = theTree.lookupRange(currentRange);
						cb(null, currentNode);
					} else {
						loadIndexFragment(currentRange, function(err, receiverNode){
							if (err){
								cb(err);
								return;
							}

							cb(null, receiverNode);
						}, true); //mustFind == true
					}
				};

				this.hasNext = function(){
					return !(currentRange && currentRange.end.equals(PearsonRange.MAX_RANGE.end));
				};
			}

			return new NodeIterator();
		};

		self.iterator = function(cb){
			function KeyValueIterator(){

				var thisIterator = this;

				var nodeIterator = self.nodeIterator();
				var currentNode;
				var currentNodeSubCollection;
				var currentNodeSubCollectionKeysList;
				var currentNodeIteratedIndex;

				this.next = function(cb){
					if (typeof cb != 'function') throw new TypeError('cb must be a function');

					if (!currentNode){
						nodeIterator.next(function(err, nextNode){
							if (err){
								cb(err);
								return;
							}

							currentNode = nextNode;
							currentNodeSubCollection = currentNode.getBinnedRange().subCollection;
							currentNodeSubCollectionKeysList = Object.keys(currentNodeSubCollection);
							currentNodeIteratedIndex = 0;
							nextKey();
						});
					} else {
						nextKey();
					}

					function nextKey(){
						var nextVal = currentNodeSubCollection[currentNodeSubCollectionKeysList[currentNodeIteratedIndex]];

						currentNodeIteratedIndex++;
						if (currentNodeIteratedIndex == currentNodeSubCollectionKeysList.length){
							//End of this node's sub collection has been reach. On to the next node.
							currentNode = undefined;
						}

						cb(undefined, nextVal);
					}
				};

				this.hasNext = function(){
					return nodeIterator.hasNext() || (currentNodeIteratedIndex < currentNodeSubCollectionKeysList.length - 1);
				};
			}

			return new KeyValueIterator();
		};

		self.map = function(mapFn, cb, limit, forQuery){
			if (typeof mapFn != 'function') throw new TypeError('mapFn must be a function');
			if (typeof cb != 'function') throw new TypeError('cb must be a function');
			if (limit && !(typeof limit == 'number' && Math.floor(limit) == limit && limit > 0)) throw new TypeError('when defined, limit must be a strictly positive integer number');

			var treeTraveler = self.nodeIterator();
			var currentNode;

			var resultSet = [];

			var limitReached = false;

			function processNode(){
				/*
				* Get the data contained in the current tree node.
				* forQuery indicates whether the the node data should be copied (when forQuery == false) and shouldn't (when forQuery == true)
				* The data is not copied when forQuery == true, because when forQuery == true it is usually called from Collection.find()
				* In which case Collection.find() will perform a deep copy of the result set, to "ensure immutability of tree data"
				* In case !forQuery || forQuery == false, the data should be deep-copied here to still "ensure immutability of tree data"
				*/
				var currentSubCollection = currentNode.getBinnedRange(forQuery ? 'none' : 'clone').subCollection;

				if (forQuery){
					//If forQuery == true, mapFn receives the entire subset
					mapFn(currentSubCollection);
					nextNode();
				} else {
					var keysList = Object.keys(currentSubCollection);
					if (keysList.length == 0){
						nextNode();
						return;
					}

					for (var i = 0; i < keysList.length; i++){
						currentSubCollection[keysList[i]].id = keysList[i];
						mapFn(currentSubCollection[keysList[i]], emit);
						if (limit && resultSet.length == limit){
							limitReached = true;
							break;
						}
					}
					nextNode();
				}
			}

			function nextNode(){
				if (treeTraveler.hasNext() && !limitReached){
					treeTraveler.next(function(err, _n){
						if (err){
							cb(err);
							return;
						}

						currentNode = _n;
						processNode();
					});
				} else {
					cb(undefined, resultSet);
				}
			}

			function emit(d){
				resultSet.push(d);
			}

			nextNode();
		};

		function loadIndexFragmentForHash(h, _cb){
			var rangeOfHash = findRangeOfHash(h);
			if (!rangeOfHash) throw new Error('cannot find range for hash: ' + longToHex(h));
			//console.log('rangeOf ' + longToHex(h) + ': ' + rangeOfHash.toString());
			loadIndexFragment(rangeOfHash, _cb);
		}

		function loadIndexFragment(fRange, _cb, mustFind){
			//console.log('Loading range ' + fRange.toString())
			var fileName = pathJoin(collectionPath, fragmentNameBuilder(fRange));
			fs.readFile(fileName, function(err, fileData){
				if (err){
					//Support the case where the index fragment file doesn't exist (in Node.js and cordova-plugin-file-node-like)
					if ((typeof err == 'string' && err.indexOf('NOT_FOUND_ERR') != -1) || (err.message.indexOf('ENOENT') != -1)){
						if (mustFind){
							if (_cb) _cb('index fragment file cannot be found');
							else throw 'index fragment file cannot be found';
						} else {
							if (_cb) _cb();
						}
						return;
					}
					//Throw other errors
					if (_cb) _cb(err);
					else throw err;
					return;
				}

				if (!fileData){
					err = 'fileData is not defined';
					//console.error(err);
					_cb(err);
					return;
				}

				if (!(fileData instanceof Uint8Array || Buffer.isBuffer(fileData))){
					err = 'fileData is of invalid type';
					//console.error(err);
					_cb(err);
					return;
				}

				if (fileData.length == 0){
					err = 'fileData happens to be empty!';
					//console.error(err);
					_cb(err);
					return;
				}

				fileData = checkReadBuffer(fileData);

				cryptoFileEncoding.decrypt(fileData, collectionKey, undefined, function(err, fragmentPlainText){
					if (err){
						_cb(err);
						return;
					}

					var fragmentJSON = deserializeObject(JSON.parse(to_string(fragmentPlainText)));

					var receiverNode = theTree.insertRange(fRange, fragmentJSON);

					markUsageOf(fRange, fragmentPlainText.length);

					checkMemoryUsage();

					if (_cb) _cb(undefined, receiverNode);
				});
			});
		}

		function unloadIndexFragment(_cb){
			var fRangeStr = fragmentsLRU.lru();
			if (!fRangeStr){ //If the LRU set returns nothing, then there is nothing to be unloaded
				if (_cb) _cb();
				return;
			}

			console.log('Unloading ' + fRangeStr);

			var fRange = PearsonRange.fromString(fRangeStr);

			var freedSize = markUnloadOf(fRange);

			theTree.trimRange(fRange);

			if (_cb) _cb(undefined, freedSize);
		}

		function saveIndexFragment(fRange, fData, _cb){
			//console.log('Saving ' + fRange.toString());
			var fileName = pathJoin(collectionPath, fragmentNameBuilder(fRange));

			var fragmentPlainText = from_string(JSON.stringify(serializeObject(fData)));

			cryptoFileEncoding.encrypt(fragmentPlainText, collectionKey, function(err, fragmentCipherText){
				if (err){
					if (_cb) _cb(err);
					else throw err;
					return;
				}

				fragmentCipherText = checkWriteBuffer(fragmentCipherText);

				fs.writeFile(fileName, fragmentCipherText, function(err){
					//console.log('End of save of ' + fRange.toString());
					if (err){
						if (_cb) _cb(err);
						else throw err;
						return;
					}

					markUsageOf(fRange, fragmentPlainText.length);

					checkMemoryUsage();

					if (_cb) _cb();
				});
			});
		}

		function deleteIndexFragment(fRange, _cb){
			//console.log('Deleting ' + fRange.toString());
			var fragmentPath = pathJoin(collectionPath, fragmentNameBuilder(fRange))
			fs.unlink(fragmentPath, function(err){
				if (err){
					if ((typeof err == 'string' && err != 'FILE_NOT_FOUND') || err.message.indexOf('ENOENT') == -1){
						if (_cb) _cb(err);
						else console.error('Cannot remove index fragment ' + fragmentPath + ': ' + err);
						return;
					}
				}

				for (var i = 0; i < fragmentsList.length; i++){
					if (fragmentsList[i].equals(fRange)){
						fragmentsList.splice(i, 1);
						break;
					}
				}

				markUnloadOf(fRange);

				if (_cb) _cb();
			});
		}

		function findRangeOfHash(h){
			if (!(h instanceof Long)) throw new TypeError('h must be a Long instance');
			for (var i = 0; i < fragmentsList.length; i++){
				if (fragmentsList[i].contains(h)) return fragmentsList[i];
			}
		}

		function findRangeOfRange(r){
			if (!(r instanceof PearsonRange)) throw new TypeError('r must be a PearsonRange instance');
			for (var i = 0; i < fragmentsList.length; i++){
				if (fragmentsList[i].containsRange(r)) return fragmentsList[i];
			}
		}

		function isRangeLoaded(r){
			var currentLoadedFragmentsList = Object.keys(currentLoadedFragmentsRange);
			for (var i = 0; i < currentLoadedFragmentsList.length; i++){
				if (currentLoadedFragmentsRange[currentLoadedFragmentsList[i]].containsRange(r)) return true;
			}
			return false;
		}

		function isRangeOfHashLoaded(h){
			var currentLoadedFragmentsList = Object.keys(currentLoadedFragmentsRange);
			for (var i = 0; i < currentLoadedFragmentsList.length; i++){
				if (currentLoadedFragmentsRange[currentLoadedFragmentsList[i]].contains(h)) return true;
			}
			return false;
		}

		function markUsageOfHash(h){
			return markUsageOf(findRangeOfHash(h));
		}

		function markUsageOf(fRange, dataSize){
			var fRangeStr = fRange.toString();

			if (dataSize){ //Data size corresponding to fRange needs to be updated if dataSize is provided
				if (currentLoadedFragmentsSize[fRangeStr]) currentDataLoad -= currentLoadedFragmentsSize[fRangeStr];
				currentLoadedFragmentsSize[fRangeStr] = dataSize;
				currentDataLoad += dataSize;
			}

			if (!currentLoadedFragmentsRange[fRangeStr]){
				currentLoadedFragmentsRange[fRangeStr] = fRange;
			}

			fragmentsLRU.put(fRangeStr);
		}

		function markUnloadOf(fRange){
			var fRangeStr = fRange.toString();
			//Check that the range is flagged as "loaded" and has its size in currentLoadedFragmentsSize
			if (!currentLoadedFragmentsSize[fRangeStr]) return;

			var freedSize = currentLoadedFragmentsSize[fRangeStr];
			currentDataLoad -= currentLoadedFragmentsSize[fRangeStr];
			delete currentLoadedFragmentsSize[fRangeStr];
			delete currentLoadedFragmentsRange[fRangeStr];

			return freedSize;
		}

		function addRangeToFragmentsList(fRange){ //We want to preserve the order in the fragmentsList
			if (!(fRange instanceof PearsonRange)) throw new TypeError('fRange must be a PearsonRange');

			var foundAt = -1;
			var insertIndex = -1;
			for (var i = 0; i < fragmentsList.length; i++){
				if (fragmentsList[i].equals(fRange)){
					foundAt = i;
					break;
				}
				if (fragmentsList[i].isOnRightOf(fRange)){ //Fragment was not found, but we already went beyond where it should have been
					insertIndex = Math.max(0, i - 1);
					break;
				}
			}

			if (foundAt != -1) return; //range already in fragments list

			//Insert the range
			fragmentsList.splice(insertIndex, 0, fRange);
		}

		function removeRangeFromFragmentsList(fRange){
			for (var i = 0; i < fragmentsList.length; i++){
				if (fragmentsList[i].equals(fRange)){
					fragmentsList.splice(i, 1);
					break;
				}
			}
		}

		function checkMemoryUsage(){
			if (currentDataLoad <= maxDataLoad) return;

			while (currentDataLoad > maxDataLoad){
				unloadIndexFragment();
			}
		}
	}

	function PearsonSeedGenerator(){
		var orderingRandomData = randomBuffer(1024); //256 * 4
		var orderingArray = new Array(256);
		for (var i = 0; i < 256; i++){
			var orderWeight = 0;
			for (var j = 0; j < 4; j++){
				orderWeight += orderingRandomData[4 * i + j] * Math.pow(2, j);
			}
			orderingArray[i] = {orderWeight: orderWeight, seedElement: i};
		}

		orderingArray.sort(function(a, b){
			if (a.orderWeight < b.orderWeight){
				return -1;
			} else {
				return 1;
			}
		});

		return orderingArray.map(function(elem){
			return elem.seedElement;
		});
	}

	function checkSeedIntegrity(seed){
		var seedSet = {};
		for (var i = 0; i < 256; i++){
			var currentSeedVal = seed[i];
			if (!(currentSeedVal >= 0 && currentSeedVal <= 255)) return false;
			currentSeedVal = currentSeedVal.toString();
			if (seedSet[currentSeedVal]) return false;
			seedSet[currentSeedVal] = true;
		}

		return true;
	}

	/**
	* @private
	* Check that the parameter is a "hashable type"
	* @param {String|Number|Date|Boolean|Uint8Array} d - the data to be hashed
	* @returns {Boolean}
	*/
	function checkHashable(d){
		var td = typeof d;
		if (!((d instanceof Uint8Array || td == 'string') && d.length > 0) && !(td == 'number' || td == 'boolean') && !(d instanceof Date)) throw new TypeError('key must be either a Uint8Array, a string, a date, a number or a boolean');

		if (td == 'object'){
			if (d instanceof Uint8Array) td = 'uint8array';
			else if (d instanceof Date) td = 'date';
			else throw new Error('checkHashable is broken!');
		}

		return td;
	}

	/**
	* Get the adapted Pearson hashing function
	*/
	function PearsonHasher(seed, hashLength, numberGranularity, dateGranularity){
		if (!((Array.isArray(seed) || seed instanceof Uint8Array) && seed.length == 256)) throw new TypeError('seed must be an array containing a substitution of integers [0-255]');
		if (!checkSeedIntegrity(seed)) throw new TypeError('Invalid seed');

		hashLength = hashLength || 8;
		if (!(typeof hashLength == 'number' && Math.floor(hashLength) == hashLength && hashLength > 0 && hashLength < 9)) throw new TypeError('hashLength must be an integer in the range [1-8]');

		if (numberGranularity){
			if (!(typeof numberGranularity == 'number' && Math.round(numberGranularity) == numberGranularity && numberGranularity > 0)) throw new TypeError('when defined, numberGranularity must be a strictly positive integer number');
		} else numberGranularity = 1; //By default, round to the nearest unit

		if (dateGranularity){
			if (!(typeof dateGranularity == 'number' && Math.floor(dateGranularity) == dateGranularity && dateGranularity > 0)) throw new TypeError('when defined, dateGranularity must be a strictly positive integer number')
		} else dateGranularity = 1000; //By default, round to the nearest 1000ms (= to the nearest second)

		var booleanTrueRanges = new Array(128);
		var booleanFalseRanges = new Array(128);
		var boolTrueCount = 0, boolFalseCount = 0;

		for (var i = 0; i < seed.length; i++){
			var i16 = i.toString(16);
			if (i16.length == 1) i16 = '0' + i16;
			var rangeStr = i16 + '00000000000000_' + i16 + 'ffffffffffffff';

			var currentRange = PearsonRange.fromString(rangeStr);
			if (seed[i] % 2 == 1){
				booleanTrueRanges[boolTrueCount] = currentRange;
				boolTrueCount++;
			} else {
				booleanFalseRanges[boolFalseCount] = currentRange;
				boolFalseCount++;
			}
		}

		if (!(boolTrueCount == 128 && boolFalseCount == 128)) console.error('Internal fatal error: checkSeedIntegrity() didn\'t detect the same amount of odd and even values');

		var hasher = function(d, isLookup){
			var td = checkHashable(d);

			if (td != 'boolean'){ //Non-boolean hashing : Pearson function using type casting
				//Type conversions. Beware : the order here matters a lot...
				//Converts all the supported types to a Uint8Array
				if (td == 'date'){
					//Converts date to a number (then to a string), rounds the requested granularity (to the nearest second by default)
					d = (Math.round(d.getTime() / dateGranularity) * dateGranularity).toString();
				} else if (td == 'number'){
					//Converts rounding the number with the requested granularity and converting it to a string
					if (numberGranularity == 1) d = Math.round(d).toString(); //Dodging the "divide-multiply by 1" operations if numberGranularity == 1
					else d = (Math.round(d / numberGranularity) * numberGranularity).toString();
				}

				//Converting the string to a Uint8Array
				if (td == 'string') d = from_string(d);

				//Pearson hashing loop
				var hash = new Uint8Array(hashLength);
				var i = 0, j = 0;
				for (var j = 0; j < hashLength; j++){
					var hashByte = seed[(d[0] + j) % 256];
					for (var i = 1; i < d.length; i++){
						hashByte = seed[(hashByte ^ d[i])];
					}
					hash[j] = hashByte;
				}
				return hash;
			} else {
				if (!isLookup){
					/* Hash a boolean value
					The start of the 8-byte hash of a boolean value is
					the index of an odd seed value if d == true, and
					the index of an even seed value if d == false
					*/
					var hash = new Uint8Array(8);
					var distributed = false;
					var rIndex = 0;
					var r, currentSeedPosition, currentSeedVal;
					while (!distributed){
						if (rIndex == 0) r = randomBuffer(8);
						currentSeedPosition = r[rIndex];
						currentSeedVal = seed[currentSeedPosition];
						distributed = !!(currentSeedVal % 2 == 1) == d;
						rIndex = (rIndex + 1) % 8;
					}
					//Building the hash
					hash[0] = currentSeedVal;
					var hashEnd = randomBuffer(7);
					for (var i = 0; i < 7; i++) hash[i+1] = hashEnd[i];

					return hash;
				} else {
					/* Get the ranges that contain the searched values for a given boolean key
					If d == true, lookup indices of odd seed values
					If d == false, lookup indices of even seed values
					*/

					if (d == true) return booleanTrueRanges;
					else return booleanFalseRanges;
				}
			}
		};

		var booleanReverser = function (hash){
			if (is_hex(hash)){
				if (hash.length != 16) throw new TypeError('when hash is a hex string, it must be 16 chars long');
				hash = from_hex(has);
			}
			if (!(hash instanceof Uint8Array && hash.length == 8)) throw new TypeError('hash must be a Uint8Array of length 8 bytes');

			var seedValIndex = hash[0];
			var seedVal = seed[seedValIndex];
			return seedVal % 2 == 1; //"True" are distributed with odd values, "false" are distributed with even values
		};

		var dateToNumberCasting = function(d){
			if (!(d instanceof Date)) throw new TypeError('d must be a date instance');

			return Math.round(d.getTime() / dateGranularity) * dateGranularity;
		};

		hasher.reverseBoolean = booleanReverser;
		hasher.dateToNumber = dateToNumberCasting;

		return hasher;
	}

	/**
	* @private
	* B+ tree-like construction, to be used as index splitting and search index for Lawncipher (on id and index attributes)
	* Example (and intended) uses:
	* -central collection index. Key : docId. Value : document
	* -search tree for an attribute in the index model. Key : attributeValue. Value : matching docIDs
	*/
	function PearsonBPlusTree(hasher, maxBinWidth, disallowKeyCollisions, _booleanMode){
		//The function retruned from PearsonHasher()
		if (typeof hasher != 'function') throw new TypeError('hasher must be a function');
		//Maximum size of a bin. Ideally this number should represent the size of the data to be held by a single index fragment file
		if (maxBinWidth && !(typeof maxBinWidth == 'number' && Math.floor(maxBinWidth) == maxBinWidth && maxBinWidth > 0)) throw new TypeError('when defined, maxBinWidth must be a strictly positive integer');

		maxBinWidth = maxBinWidth || 53248; // 13 * 4096 (hoping to match 4096 block sizes)

		var self = this;

		var eventsQueue = [];

		//The events that are triggered
		//'change', parameters: range_string, subCollection
		//'delete', parameters: range_string

		var evHandlers = {};
		var rootNode = new TreeNode(PearsonRange.MAX_RANGE);

		/**
		* Attach an event handler
		* @param {String} eventName - name of the event. Possible values: 'change', 'delete'
		* @param {Function} handler - the handler function to be called when the event is triggered
		*/
		self.on = function(eventName, handler){
			if (!(typeof eventName == 'string' && eventName.length > 0)) throw new TypeError('eventName must be a string');
			if (typeof handler != 'function') throw new TypeError('handler must be a function');

			if (evHandlers[eventName]){
				evHandlers[eventName].push(handler);
			} else {
				evHandlers[eventName] = [handler];
			}
		};

		/**
		* Detach a given event handler
		* @param {String} eventName - name of the event
		* @param {Function} [handler] - the handler to detach. If this parameter is omitted, all handlers for the given eventName will be detached
		*/
		self.off = function(eventName, handler){
			if (!(typeof eventName == 'string' && eventName.length > 0)) throw new TypeError('eventName must be a string');
			if (handler && typeof handler != 'function') throw new TypeError('when defined, handler must be a function');

			if (!evHandlers[eventName]) return;

			if (handler){
				for (var i = 0; i < evHandlers[eventName].length; i++){
					if (evHandlers[eventName][i] == handler){
						evHandlers[eventName].splice(i, 1);
						break;
					}
				}
			} else {
				delete evHandlers[eventName];
			}
		};

		//Event postponing is used if timeouts are not
		self.triggerEvents = function(){
			if (eventsQueue.length == 0) return;

			var changeEvents = {}; //{rangeId, subCollectionRef}
			var deleteEvents = {}; //{rangeId, true}
			//Roll-up the events log
			for (var i = 0; i < eventsQueue.length; i++){
				var currEvent = eventsQueue[i];
				if (currEvent._change){
					changeEvents[currEvent.rangeStr] = currEvent.subCollection;
					delete deleteEvents[currEvent.rangeStr];
				} else if (currEvent._delete){
					deleteEvents[currEvent.rangeStr] = true;
					delete changeEvents[currEvent.rangeStr];
				}
			}
			//Trigger the postponed events
			var changeList = Object.keys(changeEvents);
			for (var i = 0; i < changeList.length; i++){
				triggerEv('change', [changeList[i], changeEvents[changeList[i]]]);
			}
			var deleteList = Object.keys(deleteEvents);
			for (var i = 0; i < deleteList.length; i++){
				triggerEv('delete', [deleteList[i]]);
			}
			eventsQueue = [];
		};

		self.clearEventsQueue = function(){
			eventsQueue = [];
		};

		self.getEventsQueue = function(){
			return eventsQueue;
		};

		self.scheduleEvents = function(events, noTrigger){
			if (noTrigger || eventsQueue.length > 0){
				Array.prototype.push.apply(eventsQueue, events);

				if (!noTrigger) self.triggerEvents();
			} else {
				for (var i = 0; i < events.length; i++){
					if (events[i]._change){
						triggerEv('change', [events[i].rangeStr, events[i].subCollection]);
					} else if (events[i]._delete){
						triggerEv('delete', [events[i].rangeStr]);
					} else {
						console.error('Internal error in Lawncipher\'s indexes : what is that event? ' + JSON.stringify(events[i]));
					}
				}
			}
		};

		self.rootNode = function(){
			return rootNode;
		}

		/**
		* Add a {key, value} pair to the tree
		* @param {String|Number} key - the key (i.e, identifier) that will be used to retrieve the value from the tree
		* @param {String|Object|Number} [value] - the data to be stored in the tree for the given key. If value is missing, it is assumed that key is a documentId and the corresponding document will be retrieved from the current collection
		*/
		self.add = function(key, value, noTrigger, replace, _withHash){
			checkHashable(key);
			//if (!((typeof key == 'string' && key.length > 0) || (typeof key == 'number' && !isNaN(key)))) throw new TypeError('key must be a non-empty string or a number');

			var valType = typeof value;
			if (!(valType == 'string' || valType == 'number' || valType == 'object')) throw new TypeError('value must either be a string, a number, or a JSON object');

			if (_withHash){
				if (!(_withHash instanceof Uint8Array && _withHash.length == 8)) throw new TypeError('if _withHash is provided, it must be an 8 byte Uint8Array');

				rootNode.addWithHash(_withHash, key, value, noTrigger, replace);
			} else {
				rootNode.add(key, value, noTrigger, replace);
			}
		};

		self.remove = function(key, value, noTrigger, _withHash){
			checkHashable(key);
			//if (!((typeof key == 'string' && key.length > 0) || (typeof key == 'number' && !isNaN(key)))) throw new TypeError('key must be a non-empty string or a number');

			if (_withHash){
				if (!(_withHash instanceof Uint8Array && _withHash.length == 8)) throw new TypeError('if _withHash is provided, it must be an 8 byte Uint8Array');

				rootNode.removeWithHash(_withHash, key, value, noTrigger);
			} else {
				rootNode.remove(key, value, noTrigger);
			}
		};

		/**
		* Insert tree data for a given range.
		* The inserted data is considered as "already saved data", and hence we do not trigger the "change" event at the end of this
		* It's just an "insertion in memory"
		* @param {String|Long|Uint8Array} startRange - the beginning of the data range to insert
		* @param {String|Long|Uint8Array} endRange - the end of the data range to insert
		* @param {Object} subCollection - the documents/tree data to insert
		*/
		self.insertRange = function(insertRange, subCollection){
			if (!(insertRange instanceof PearsonRange)) throw new TypeError('insertRange must be a PearsonRange instance');

			var receiverNode;
			var currentNode = rootNode;
			var currentNodeRange, nextRanges;
			var isHolderOfRange = false;
			do {
				currentNodeRange = currentNode.range();
				nextRanges = currentNodeRange.split();
				if (currentNodeRange.equals(insertRange)){
					isHolderOfRange = true;
					currentNode.setSubCollection(subCollection);
					receiverNode = currentNode;
				} else {
					var splittedRange = currentNodeRange.split();
					var leftNode, rightNode;
					if (currentNode.isLeaf()){
						var newLeftNode = new TreeNode(splittedRange[0], undefined, currentNode);
						var newRightNode = new TreeNode(splittedRange[1], undefined, currentNode);
						//Referencing children nodes to parent
						currentNode.setLeft(newLeftNode);
						currentNode.setRight(newRightNode);
						//Setting leftNode and rightNode with the newly created nodes
						leftNode = newLeftNode;
						rightNode = newRightNode;
					} else {
						leftNode = currentNode.getLeft();
						rightNode = currentNode.getRight();
					}

					if (insertRange.isContainedIn(splittedRange[0])){
						currentNode = leftNode;
					} else if (insertRange.isContainedIn(splittedRange[1])){
						currentNode = rightNode;
					} else {
						//Handles the case that insertRange is not an evenly cut range
						console.log('NOT EVENLY CUT!');
						if (!(insertRange.isContainedIn(nextRanges[0]) || insertRange.isContainedIn(nextRanges[1]))){
							isHolderOfRange = true;
							currentNode.mergeSubCollection(subCollection, !disallowKeyCollisions);
							receiverNode = currentNode;
						} else {
							console.error('CRITICAL INTERNAL ERROR : your ranges are messed up')
							break;
						}
					}

					/*if (isRangeContainedIn(splittedRange[0].start, splittedRange[0].end, insertRange.start, insertRange.end)){
						currentNode = leftNode;
					} else if (isRangeContainedIn(splittedRange[1].start, splittedRange[1].end, startRange, endRange)){
						currentNode = rightNode
					} else {
						//Handles the case that insertRange is not an evenly cut range
						if (!(insertRange.isContainedIn(nextRanges[0]) || insertRange.isContainedIn(nextRanges[1]))){
							isHolderOfRange = true;
							currentNode.mergeSubCollection(subCollection, !disallowKeyCollisions)
						} else {
							console.error('CRITICAL INTERNAL ERROR : your ranges are messed up')
							break;
						}
					}*/
				}
			} while (!isHolderOfRange);

			return receiverNode;
		};

		/**
		* Remove data for a given range from the tree
		* It's just an "in memory removal", and hence the "delete" event is not triggered
		* @param {PearsonRange} tRange - the range of data to trim. It has to be a range "cut by dichotomy"
		*/
		self.trimRange = function(tRange){
			if (!(tRange instanceof PearsonRange)) throw new TypeError('tRange must be a PearsonRange instance');

			var currentNode = rootNode;
			var currentNodeRange;
			var isHolderOfRange = false;

			do {
				currentNodeRange = currentNode.range();
				if (currentNodeRange.equals(tRange)){
					isHolderOfRange = true;
					if (currentNode == rootNode){ //If we are still at the root node, trimming will result in de-referencing the subCollection the root node contains
						rootNode.setSubCollection({});
					} else {
						var nodeParent = currentNode.getParent();
						if (nodeParent.getRight() == currentNode){ //Current node is its parent's right child
							nodeParent.setRight(); //De-referencing the node
						} else if (nodeParent.getLeft() == currentNode){ //Current node is its parent's left child
							nodeParent.setLeft(); //De-referencing the node
						} else {
							console.error('What the hell. Your parent is denying your existence.');
							return;
						}
					}
				} else {
					if (currentNode.isLeaf()){
						//No node below this one
						isHolderOfRange = true;
						//Calculate hashes of the keys contained in this node, and remove those that fit tRange
						var keyList = Object.keys(currentNode._subCollection);
						if (keyList.length == 0) return; //Nothing to test or remove
						for (var i = 0; i < keyList.length; i++){
							var currentKeyHash = _booleanMode ? hexToLong(keyList[i]) : hashToLong(keyList[i]);
							if (tRange.contains(currentKeyHash)){
								delete currentNode._subCollection[keyList[i]];
							}
						}
					} else {
						var nextRanges = currentNodeRange.split();
						if (nextRanges[0].containsRange(tRange)){
							currentNode = currentNode.getLeft();
						} else if (nextRanges[1].containsRange(tRange)){
							currentNode = currentNode.getRight();
						} else {
							console.error('You got lost');
							return;
						}

						if (!currentNode){ //The node that's supposed to hold the range that we want to trim doesn't exist. Stop
							return;
						}
					}
				}
			} while (!isHolderOfRange);
		}

		/**
		* Retrieve an element given its key
		* @param {String|Number} key
		* @param {String|Uint8Array} [hash] - the Pearson hash of the given key
		*/
		self.lookup = function(key, hash){
			checkHashable(key);
			//if (!(typeof key == 'string' || typeof key == 'number')) throw new TypeError('key must be a string or number');

			if (!hash) hash = hashToLong(key, true);
			if (key instanceof Date) key = hasher.dateToNumber(key);

			return rootNode.lookup(key, hash);
		};

		self.lookupRange = function(fRange){
			if (!(fRange instanceof PearsonRange)) throw new TypeError('fRange must be a PearsonRange');

			return rootNode.lookupRange(fRange);
		};

		/**
		* @private
		* @param {String} evName - name of the event
		* @param {Array} args - list of the arguments to be passed to the event handler, if found
		* @param {Object<Function>} [_handlers] - list of handler functions to call
		*/
		function triggerEv(evName, args, _handlers){
			var handlers = _handlers || evHandlers;
			if (!handlers[evName]) return;

			var currentEvHandlers = handlers[evName];
			for (var i = 0; i < currentEvHandlers.length; i++){
				currentEvHandlers[i].apply(undefined, args);
			}
		}

		/**
		* @private
		* @param {PearsonRange} dataRange - hash range that this node (and its children) will hold
		* @param {Object} [_subCollection] - pre-load of data to be held by this node
		* @param {TreeNode} [_parent] - the node that is parent to this one
		*/
		function TreeNode(dataRange, _subCollection, _parent){
			if (!(dataRange instanceof PearsonRange)) throw new TypeError('dataRange must be a PearsonRange instance');
			if (_subCollection){
				if (typeof _subCollection != 'object') throw new TypeError('when defined, _subCollection must be an object');
				checkSubCollection(_subCollection, '_subCollection');
			 	//if (!Array.isArray(_preloadDocIds)) throw new TypeError('when defined, _preloadDocIds must be an array');
				//checkStringArray(_preloadDocIds, '_preloadDocIds');
			}

			var left, right, parent;
			if (_parent){
				if (!(_parent instanceof TreeNode)) throw new TypeError('when defined, _parent must be a tree node instance');
				parent = _parent;
			}

			var thisNode = this;

			var middlePoint = dataRange.midRange();
			var subCollection = _subCollection || {};
			var currentDataSize = 0;

			var docIds = Object.keys(subCollection);
			if (docIds.length > 0){ //Data has been provided on initialization. It's total size must be estimated
				for (var i = 0; i < docIds.length; i++){
					currentDataSize += getDocSize(data[i]);
				}
			}

			thisNode._subCollection = subCollection;

			/**
			* Set the subCollection of data to be held by this tree node
			* @param {Object} _subCollection - the data to be held by this node. In the form of {key: value}, or {key: [value1, value2, ...]}
			*/
			thisNode.setSubCollection = function(_subCollection){
				if (typeof _subCollection != 'object') throw new TypeError('_subCollection must an object');
				checkSubCollection(_subCollection, '_subCollection');

				if (!isLeaf()){
					throw new Error('Node cannot receive subCollection if not leaf');
				}

				subCollection = _subCollection;
				currentDataSize = jsonSize(subCollection);
				thisNode._subCollection = _subCollection;
			};

			thisNode.mergeSubCollection = function(_subCollection, replaceOnCollision){
				if (typeof _subCollection == 'object') throw new TypeError('_subCollection must be an object');
				checkSubCollection(_subCollection, '_subCollection');

				if (!isLeaf()){
					throw new Error('Node cannot receive subCollection if not leaf');
				}

				var keysToMerge = Object.keys(_subCollection);
				for (var i = 0; i < _subCollection.length; i++){
					if (subCollection[keysToMerge[i]]){
						if (disallowKeyCollisions){
							if (replaceOnCollision) subCollection[keysToMerge[i]] = _subCollection[keysToMerge[i]];
							else throw new Error('Index already contains element with key ' + keysToMerge[i]);
						} else {
							var collisionningValues = _subCollection[keysToMerge[i]];
							for (var j = 0; j < collisionningValues.length; j++){
								subCollection[keysToMerge[i]].push(collisionningValues[j]);
							}
						}
					} else {
						subCollection[keysToMerge[i]] = _subCollection[keysToMerge[i]];
					}
				}
			};

			/**
			* Add a key in the tree, with its value. If value is missing, key is assumed to be a docId
			* @param {String|Number} key - the key (i.e, identifier) that will be used to retrieve the value from the tree
			* @param {String|Number|Object} [value] - the data to be stored in the tree for the given key. If value is missing, it is assumed that key is a documentId and the corresponding document will be retrieved from the current collection
			*/
			thisNode.add = function(key, value, noTrigger, replace){
				var keyHash = hasher(key);
				thisNode.addWithHash(keyHash, key, value, noTrigger, replace);
			};

			/**
			* Add a {key, value} pair, provided the hash of key
			* @param {Uint8Array|Long} hash - Pearson hash of key
			* @param {String|Number} key - the key to add to the tree
			* @param {String|Number|Object} [value] - the value to be stored in the tree for the given {hash, key}. If value is missing, it is assumed that key is a documentId and the corresponding document will be retrieved from the collection
			*/
			thisNode.addWithHash = function(hash, key, value, noTrigger, replace){
				if (!(hash instanceof Uint8Array && hash.length == 8) && !(hash instanceof Long)) throw new TypeError('hash must be a non-empty array or a Long instance');
				if (hash instanceof Uint8Array){
					hash = bufferBEToLong(hash);
				}

				if (key instanceof Date) key = hasher.dateToNumber(key);

				if (isLeaf()){
					var newDataSize = docSize(value, key);
					var newNodeSize = currentDataSize + newDataSize;
					if (newNodeSize >= maxBinWidth){
						splitNode(noTrigger);
						if (hash.lte(middlePoint)){
							left.addWithHash(hash, key, value, noTrigger, replace);
						} else {
							right.addWithHash(hash, key, value, noTrigger, replace);
						}
					} else {
						currentDataSize += newDataSize;

						if (disallowKeyCollisions){
							if (subCollection[key] && !replace) throw new RangeError('key "' + key + '" already taken');
							subCollection[key] = value
						} else {
							if (subCollection[key]) subCollection[key].push(value);
							else subCollection[key] = [value];
						}

						self.scheduleEvents([{_change: true, rangeStr: getRangeString(thisNode.range()), subCollection: subCollection}], noTrigger);
						//if (!noTrigger) self.triggerEvents();
					}
				} else {
					if (hash.lte(middlePoint)){
						//Go to left-side child
						left.addWithHash(hash, key, value, noTrigger, replace);
					} else {
						//Go to right-side child
						right.addWithHash(hash, key, value, noTrigger, replace);
					}
				}
			};

			/**
			* Remove a {key, value} pair from the tree
			* @param {String|Number} key
			* @param {String|Number|Object} [value]
			*/
			thisNode.remove = function(key, value, noTrigger){
				var keyHash = hasher(key);
				thisNode.removeWithHash(keyHash, key, value, noTrigger);
			};

			/**
			* Remove a {key, value} pair from the tree
			* @param {Uint8Array|Long} hash
			* @param {String|Number} key
			* @param {String|Number|Object} [value]
			*/
			thisNode.removeWithHash = function(hash, key, value, noTrigger){
				if (!(hash instanceof Uint8Array && hash.length == 8) && !(hash instanceof Long)) throw new TypeError('hash must be a non-empty array of a Long instance');
				if (hash instanceof Uint8Array){
					hash = bufferBEToLong(hash);
				}

				if (key instanceof Date) key = hasher.dateToNumber(key);

				if (isLeaf()){
					if (!subCollection[key]) return;

					var dataSizeToRemove = (value && docSize(value, key)) || jsonSize(subCollection[key]);
					currentDataSize -= dataSizeToRemove;
					if (value && !disallowKeyCollisions){
						if (subCollection[key]){
							for (var i = 0; i < subCollection[key].length; i++){
								if (subCollection[key][i] == value){
									subCollection[key].splice(i, 1);
									break;
								}
							}
							if (subCollection[key].length == 0) delete subCollection[key];
						}
					} else {
						//No "value" -> key is docId -> docId is unique
						delete subCollection[key];
					}
					if (currentDataSize < maxBinWidth / 2 && !(dataRange.equals(rootNode.range()))){
						//Do not trigger events from this method in this case. They will be triggered by the mergeWithSibling call
						mergeWithSibling(noTrigger);
					} else {
						self.scheduleEvents([{_change: true, rangeStr: getRangeString(thisNode.range()), subCollection: subCollection}] , noTrigger);
						//if (!noTrigger) self.triggerEvents();
					}
				} else {
					if (hash.lte(middlePoint)){
						left.removeWithHash(hash, key, value, noTrigger);
					} else {
						right.removeWithHash(hash, key, value, noTrigger);
					}
				}
			};

			/**
			* Retrieve a key
			* @param {String|Number} key
			* @param {Long} hash
			*/
			thisNode.lookup = function(key, hash){
				if (key instanceof Date) key = hasher.dateToNumber(key);

				if (this.isLeaf()){
					return subCollection[key] && clone(subCollection[key]);
				} else {
					if (hash.lte(middlePoint)){
						return left.lookup(key, hash);
					} else {
						return right.lookup(key, hash);
					}
				}
			};

			/**
			* Retrieve the data subset that is held a tree leaf that match a given range
			* @param {PearsonRange} fRange
			* @param {Object} subset <Key,Value>
			*/
			thisNode.lookupRange = function(fRange){
				if (this.isLeaf()){
					return this;
					/*if (this.range().equals(fRange)){
						return this;
					} else {
						var nodeData = this.getBinnedRange();
						nodeData = nodeData.subCollection;

					}*/
				} else {
					if (left.range().containsRange(fRange)){
						return left.lookupRange(fRange);
					} else if (right.range().containsRange(fRange)){
						return right.lookupRange(fRange);
					} else {
						return null; //No node cannot be found bearing the exact fRange
					}
				}
			};

			/**
			* Get data range of tree node
			* @returns {Object} {Long startRange, endRange}
			*/
			thisNode.range = function(){
				return dataRange;
			};

			/**
			* Get parent node of this tree node
			* @returns {TreeNode|Null}
			*/
			thisNode.getParent = function(){
				return parent;
			}

			/**
			* Get left-side child
			* @returns {TreeNode|Null}
			*/
			thisNode.getLeft = function(){
				return left;
			};

			/**
			* Get right-side child
			* @returns {TreeNode|Null}
			*/
			thisNode.getRight = function(){
				return right;
			};

			/**
			* Set left-side child node
			* @param {TreeNode} [l] - leave undefined to unset left-side child
			*/
			thisNode.setLeft = function(l){
				if (l && !(l instanceof TreeNode)) throw new TypeError('l must be a tree node');
				left = l;
			};

			/**
			* Set right-side child node
			* @param {TreeNode} [r] - leave undefined to unset right-side child
			*/
			thisNode.setRight = function(r){
				if (r && !(r instanceof TreeNode)) throw new TypeError('r must be a tree node');
				right = r;
			};

			/**
			* Is this node a leaf node?
			* @returns {Boolean} - true if it is a leaf node, false if it isn't
			*/
			thisNode.isLeaf = isLeaf;

			/**
			* @returns {Object} - {start, end, subCollection}
			*/
			thisNode.getBinnedRange = function(copyType){
				if (isLeaf()){
					var resultObject = {range: dataRange};
					if (!copyType || copyType == 'shallow'){
						resultObject.subCollection = shallowCopy(subCollection);
					} else if (copyType == 'clone'){
						resultObject.subCollection = clone(subCollection);
					} else if (copyType == 'none'){
						resultObject.subCollection = subCollection;
					}
					return resultObject;
				}/* else {
					throw 'Incomplete';
					var rightBinnedRange = thisNode.right.getBinnedRange();
					var leftBinnedRange = thisNode.left.getBinnedRange();
				}*/
			};

			function isLeaf(){
				return !(left || right);
			}

			function mergeWithSibling(noTrigger){
				if (!isLeaf()) return; //Cannot merge with sibling if you are not a leaf
				if (!parent) return; //To have a sibling, you must have a parent

				var isLeftNode = parent.getLeft() == thisNode;
				var isRightNode = !isLeftNode;

				var sibling = isLeftNode ? parent.getRight() : parent.getLeft(); //sibling = child of same parent, at the opposite side
				if (!sibling.isLeaf()) return; //Give up the merge if sibling node is not also a leaf

				var thisNodeRange = thisNode.range();
				var siblingBinnedRange = sibling.getBinnedRange();

				var mergedSubCollection = {};

				var myValueList = Object.keys(subCollection);
				for (var i = 0; i < myValueList.length; i++){
					mergedSubCollection[myValueList[i]] = subCollection[myValueList[i]];
				}

				var siblingValueList = Object.keys(siblingBinnedRange.subCollection);
				for (var i = 0; i < siblingValueList.length; i++){
					mergedSubCollection[siblingValueList[i]] = siblingBinnedRange.subCollection[siblingValueList[i]];
				}

				parent.setRight(undefined);
				parent.setLeft(undefined);
				parent.setSubCollection(mergedSubCollection);

				//trigger delete events for sub-ranges for this node and its sibling
				self.scheduleEvents([
					{_delete: true, rangeStr: thisNodeRange.toString()},
					{_delete: true, rangeStr: siblingBinnedRange.range.toString()},
					{_change: true, rangeStr: parent.range().toString(), subCollection: mergedSubCollection}
				], noTrigger);
				//if (!noTrigger) self.triggerEvents();
			}

			function splitNode(noTrigger){
				if (dataRange.width == 1) return;
				var splitedRange = dataRange.split();
				var leftRange = splitedRange[0], rightRange = splitedRange[1];
				var leftNode = new TreeNode(leftRange, null, thisNode);
				var rightNode = new TreeNode(rightRange, null, thisNode);

				thisNode.setLeft(leftNode);
				thisNode.setRight(rightNode);

				//Split the data
				var subCollectionList = Object.keys(subCollection);
				var leftSubCollection = {}, rightSubCollection = {};
				for (var i = 0; i < subCollectionList.length; i++){
					var currentHash;
					if (_booleanMode) currentHash = hexToLong(subCollectionList[i]); //In boolean mode, the hashes are used as keys...
					else currentHash = hashToLong(subCollectionList[i]);

					if (leftRange.contains(currentHash)){
						leftSubCollection[subCollectionList[i]] = subCollection[subCollectionList[i]];
					} else if (rightRange.contains(currentHash)){
						rightSubCollection[subCollectionList[i]] = subCollection[subCollectionList[i]];
					} else {
						console.error('Error in hash distribution');
					}
				}
				leftNode.setSubCollection(leftSubCollection);
				rightNode.setSubCollection(rightSubCollection);
				//Clear data from this node
				subCollection = null;
				//Trigger events
				self.scheduleEvents([
					{_delete: true, rangeStr: dataRange.toString()},
					{_change: true, rangeStr: leftRange.toString(), subCollection: leftSubCollection},
					{_change: true, rangeStr: rightRange.toString(), subCollection: rightSubCollection}
				], noTrigger);
				//if (!noTrigger) self.triggerEvents();
			}
		}

		self.TreeNode = TreeNode;

		function hashToLong(d, isLookup){
			//Type conversions and checks are now done by hasher()
			return bufferBEToLong(hasher(d, isLookup), isLookup);
		}

		function findCommonPrefix(a, b){
			if (!(a instanceof Uint8Array && a.length > 0)) throw new TypeError('a must be a non-empty Uint8Array');
			if (!(b instanceof Uint8Array && b.length > 0)) throw new TypeError('b must be a non-empty Uint8Array');

			var maxPrefixLength = Math.min(a.length, b.length);
			var prefixLength = 0;
			for (var i = 0; i < maxPrefixLength; i++){
				if (a[i] != b[i]){
					prefixLength = i;
					break;
				}
			}

			if (prefixLength == 0) return;

			var p = new Uint8Array(prefixLength);
			for (var i = 0; i < p.length; i++) p[i] = a[i];
			return p;
		}
	}

	function PearsonRange(start, end, _rangeStr){
		if (typeof start == 'string'){
			if (!(start.length == 16 && is_hex(start))) throw new TypeError('when start is a string, it must be a hex representation of a long (i.e, 8 bytes -> 16 hex chars)');
			start = from_hex(start);
		}
		if (start instanceof Uint8Array){
			start = bufferBEToLong(start);
		}
		if (!(start instanceof Long && start.unsigned)) throw new TypeError('start must be either a hex string, an 8 byte buffer, or an unsigned Long instance');

		if (typeof end == 'string'){
			if (!(end.length == 16 && is_hex(end))) throw new TypeError('when end is a string, it must be a hex representation of a long (i.e, 8 bytes -> 16 hex chars)');
			end = from_hex(end);
		}
		if (end instanceof Uint8Array){
			end = bufferBEToLong(end);
		}
		if (!(end instanceof Long && end.unsigned)) throw new TypeError('end must be either a hex string, an 8 byte buffer, or an unsigned Long instance');

		if (_rangeStr && !(typeof _rangeStr == 'string' && _rangeStr.length > 0)) throw new TypeError('when defined, _rangeStr must be a non-empty string');

		Object.defineProperty(this, 'start', {
			value: start,
			enumerable: true
		});
		Object.defineProperty(this, 'end', {
			value: end,
			enumerable: true
		});
		Object.defineProperty(this, 'width', {
			value: rangeWidth(start, end),
			enumerable: true
		});

		var rangeStr = _rangeStr || getRangeString(this);
		Object.defineProperty(this, '_rangeStr', {
			value: rangeStr,
			enumerable: false
		});
	}

	PearsonRange.prototype.midRange = function(){
		return midRange(this.start, this.end);
	}

	PearsonRange.prototype.toString = function(){
		return this._rangeStr;
	};

	PearsonRange.prototype.split = function(){
		var parts = splitRange(this.start, this.end);
		return [new PearsonRange(parts[0].s, parts[0].e), new PearsonRange(parts[1].s, parts[1].e)];
	};

	PearsonRange.prototype.contains = function(h){
		if (!(h instanceof Long && h.unsigned)) throw new TypeError('h must be an unsigned Long instance');
		return isHashContainedIn(this.start, this.end, h);
	};

	PearsonRange.prototype.containsRange = function(r){
		if (!(r instanceof PearsonRange)) throw new TypeError('r must be a PearsonRange instance');
		return isRangeContainedIn(this.start, this.end, r.start, r.end);
	};

	PearsonRange.prototype.isContainedIn = function(r){
		if (!(r instanceof PearsonRange)) throw new TypeError('r must be a PearsonRange instance');
		return isRangeContainedIn(r.start, r.end, this.start, this.end);
	};

	PearsonRange.prototype.equals = function(r){
		if (!(r instanceof PearsonRange)) throw new TypeError('r must be a PearsonRange instance');
		return this.start.equals(r.start) && this.end.equals(r.end);
	};

	PearsonRange.prototype.isRightNeighbor = function(rightNeighborRange){
		if (!(rightNeighborRange instanceof PearsonRange)) throw new TypeError('rightNeighborRange must be a PearsonRange instance');
		//If this range's end is at MAX, then this range cannot have a right-side neighbor
		if (this.end.equals(PearsonRange.MAX_RANGE.end)) return false;
		//Check that the neighbor's start == this end's + 1
		return this.end.add(1).equals(rightNeighborRange.start);
	};

	PearsonRange.prototype.isLeftNeighbor = function(leftNeighborRange){
		if (!(leftNeighborRange instanceof PearsonRange)) throw new TypeError('leftNeighborRange must be a PearsonRange instance');
		//If this range's start is at MAX, then this range cannot have a left-side neighbor
		if (this.start.equals(PearsonRange.MAX_RANGE.start)) return false;
		//Check that the neighbor's end == this start's - 1
		return this.start.sub(1).equals(leftNeighborRange.end);
	};

	PearsonRange.prototype.isOnLeftOf = function(rightRange){
		if (!(rightRange instanceof PearsonRange)) throw new TypeError('rightRange must be a PearsonRange instance');

		if (this.end.equals(PearsonRange.MAX_RANGE.end)) return false;

		return this.end.lt(rightRange.start);
	};

	PearsonRange.prototype.isOnRightOf = function(leftRange){
		if (!(leftRange instanceof PearsonRange)) throw new TypeError('leftRange must be a PearsonRange instance');

		if (this.start.equals(PearsonRange.MAX_RANGE.start)) return false;

		return this.start.gt(leftRange.end);
	};

	PearsonRange.prototype.toJSON = function(){
		return this.toString();
	};

	PearsonRange.fromString = function(rangeStr){
		var rangeParts = getRangePartsFromString(rangeStr);
		return new PearsonRange(rangeParts.start, rangeParts.end, rangeStr);
	};

	PearsonRange.MAX_RANGE = PearsonRange.fromString('0000000000000000_ffffffffffffffff');

	function LRUStringSet(){
		this._d = [];
	}

	LRUStringSet.prototype.put = function(elem){
		if (!(typeof elem == 'string' && elem.length > 0)) return -1;

		var foundAt = -1;
		for (var i = 0; i < this._d.length; i++){
			if (this._d[i] == elem){
				foundAt = i;
				break;
			}
		}

		//Remove the element from its current position, to be put back to the front
		if (foundAt != -1) this._d.splice(foundAt, 1);

		return this._d.unshift(elem);
	};

	LRUStringSet.prototype.lru = function(){
		if (this._d.length == 0) return;
		return this._d.pop();
	};

	function bufferBEToLong(b, isArrayOfBuffers){
		if (isArrayOfBuffers && Array.isArray(b) && b.length > 0){
			/*
			* Why that many conditions? Because isArrayOfBuffers == true when isLookup == true
			* But isLookup == true when the tree/index is performing a lookup, regardless of index type
			* So, it happens often that we don't receive an array even though isArrayOfBuffers == true
			* Therefore, we also have to check that b is indeed an array when isArrayOfBuffers == true
			*/
			var r = [];
			for (var i = 0; i < b.length; i++){
				r.push(bufferBEToLong(b[i]));
			}
			return r;
		}

		var l = 0, h = 0;
		for (var i = 0; i < 4; i++){
			h += b[i] * Math.pow(2, 8 * (3 - i));
		}
		for (var i = 0; i < 4; i++){
			l += b[i+4] * Math.pow(2, 8 * (3 - i));
		}
		return new Long(l, h, true);
	}

	function longToBufferBE(l){
		var b = new Uint8Array(8);
		var highBits = l.getHighBitsUnsigned();
		var lowBits = l.getLowBitsUnsigned();
		for (var i = 0; i < 4; i++){
			b[i] = (highBits >> 8 * (3 - i)) % 256;
		}
		for (var i = 0; i < 4; i++){
			b[i+4] = (lowBits >> 8 * (3 - i)) % 256;
		}
		return b;
	}

	function splitRange(s, e){
		var middle = midRange(s, e);
		return [{s: s, e: middle}, {s: middle.add(1), e: e}];
	}

	function midRange(s, e){
		var rangeWidth = e.subtract(s);
		var middle = s.add(rangeWidth.shru(1));
		return middle;
	}

	/*
		rangeWidth is used to see whether a given range can be splitted.
		If that check is done via if (r.width == 1) return;, then the
		formule end-start+1 is unsuited for that check. Hence we are
		simply using end-start, where width would then represent
		the number of integers "that we must count" to go from the start
		to the end (and not the number of the number of integers in that range)
	*/
	function rangeWidth(s, e){
		return e.subtract(s); //.add(1); //end - start + 1
	}

	function isRangeContainedIn(containerStart, containerEnd, start, end){
		return containerStart.lte(start) && containerEnd.gte(end);
	}

	function isHashContainedIn(containerStart, containerEnd, h){
		return containerStart.lte(h) && containerEnd.gte(h);
	}

	function longToHex(l){
		return to_hex(longToBufferBE(l));
	}

	function hexToLong(s){
		return bufferBEToLong(from_hex(s));
	}

	function getRangeString(rangeObj){
		return longToHex(rangeObj.start || rangeObj.s) + '_' + longToHex(rangeObj.end || rangeObj.e);
	}

	function getRangePartsFromString(rangeStr){
		var rangeParts = rangeStr.split('_');
		return {start: hexToLong(rangeParts[0]), end: hexToLong(rangeParts[1])};
	}

	function jsonSize(o){
		var oType = typeof o;
		if (oType == 'string') return o.length + 2; //+2 for the double quotes encapsulating strings in JSON
		else if (oType == 'number' || oType == 'boolean') return o.toString().length;
		else if (oType == 'undefined' || oType == 'function') return 0;

		if (oType != 'object') return 0;
		//Beyond this point, o is an object
		var oSize = 0;
		if (o == null){
			oSize = 4;
		} else if (Array.isArray(o)){
			oSize += 2;
			for (var i = 0; i < o.length; i++){
				oSize += jsonSize(o[i]);
				if (i != o.length - 1) oSize++; //A comma after each element, except the last one
			}
		} else if (o instanceof Date){
			return jsonSize(o.toISOString());
		} else {
			var attrList = Object.keys(o);
			oSize += 2; //counting {}
			for (var i = 0; i < attrList.length; i++){
				oSize += attrList[i].length + 3; //Counting attribute length + "":
				oSize += jsonSize(o[attrList[i]]); //Counting attribute value's size
				if (i != attrList.length - 1) oSize++; //A comme after each attribute, expect the last one
			}
		}

		return oSize;
	}

	function docSize(doc, id){
		return jsonSize(doc) + ((id && jsonSize(id)) || 0);
	}

	exports.Index = Index;
	exports.PearsonBPlusTree = PearsonBPlusTree;
	exports.PearsonRange = PearsonRange;
	exports.PearsonHasher = PearsonHasher;
	exports.PearsonSeedGenerator = PearsonSeedGenerator;
	exports.LRUStringSet = LRUStringSet

	exports.bufferBEToLong = bufferBEToLong;
	exports.longToBufferBE = longToBufferBE;
	exports.from_string = from_string;
	exports.to_string = to_string;
}));
