(function(LockateMeApp, window){

	/*
		A good chunk of this code is harvested from hpka.js and adapted to work in the current crypto architecture
		Namely, there is onylone call to scrypt per session. The resulting key is used to decrypt the user's identityKey and is used a root key in Lawncipher
		Also, since the code path for scrypt is different on iOS and Android, we must seperate the file's encoding/decoding from the calls to scrypt (unlike what's currently done in hpka.js)
	*/

	var sodium = window.sodium;
	if (!sodium) throw new Error('libsodium is missing!');

	var from_string = sodium.from_string, to_string = sodium.to_string;
	var from_hex = sodium.from_hex, to_hex = sodium.to_hex;

	var cryptoFileEncoding = {
		encrypt: scryptFileEncode,
		decrypt: scryptFileDecode,
		decode: scryptFileDecodeHeader
	};

	LockateMeApp.cryptoFileEncoding = cryptoFileEncoding;

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

	function randomBuffer(size){
		if (!(typeof size == 'number' && size > 0 && Math.floor(size) == size)) throw new TypeError('size must be a strictly positive integer');
		var b = new Uint8Array(size);
		window.crypto.getRandomValues(b);
		return b;
	}

})(window.LockateMeApp = window.LockateMeApp || {}, window);
