module.exports = function(grunt){

	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		jsvalidate: {
			options: {
				globals: {},
				esprimaOptions: {},
				verbose: true
			},
			src: ['lawncipher.js'],
			tests: ['test.js', 'tests/**/*.js']
		}
	});

	grunt.loadNpmTasks('grunt-jsvalidate');

	grunt.registerTask('default', ['jsvalidate']);

};
