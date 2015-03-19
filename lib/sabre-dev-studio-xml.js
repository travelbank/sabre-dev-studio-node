/*
 * sabre-dev-studio
 * https://github.com/SabreLabs/sabre-dev-studio-node
 *
 * Copyright (c) 2014 Sabre Corp
 * Licensed under the MIT license.
 */

'use strict';
var SabreDevStudioXml = ( function() {
  function SabreDevStudioXml( options ){
    // Our requires
    var request = require( 'soap/lib/http' ).request;
    var xml2js = require( 'xml2js' );
    var handlebars = require( 'handlebars' );
    var fs = require( 'fs' );
    var _ = require( 'lodash' );
    var bunyan = require( 'bunyan' );
    // Setup our logging function
    var log = bunyan.createLogger( {
      name: 'SabreDevStudio',
      level: options.loglevel || 'warn'
    } );
    delete options.loglevel;
    // Pull in our lodash mixin for deep operations
    _.mixin( require( 'lodash-deep' ) );
    // Setup some initial variables
    var that = this;
    // Holds our config options
    this.config = {
      // Get this info from Sabre!
      ipcc: false,
      user: false,
      password: false,
      uri: 'https://webservices3.sabre.com' // Defaults to production
    };
    // Holds our state object
    this.state = {
      // Our security token
      securityToken: false,
      // Holds our handlebars compiled templates
      templates: {}
    };
    // Do some init stuff
    _.assign( this.config, options );
    log.info( 'Initializing SabreDevStudioXml with config:' );
    log.info( this.config );
    /**
     * Get a security token from the SessionCreateRQ service
     * @param function standard node callback
     */
    this.CreateSession = function( cb ){
      /** Just call the service directly, passing the callback function */
      this._callService( 'SessionCreateRQ', {
        soapAction: 'OTA'
      }, function( err, body, full, response ){
        if( !_.isNull( err ) ){
          return cb( err );
        }
        var status = _.deepGet( body, 'SessionCreateRS[0].$.status' );
        // If we don't have a status of approved, something went wrong
        if( status != 'Approved' ){
          // Try to get the fault string, then bail
          var faultString = _.deepGet( body, 'soap-env:Fault[0].faultstring[0]' );
          return cb( faultString || 'Could not CreateSession with Sabre for an unknown reason.' );
        }
        // Try to get the security token
        var securityToken = _.deepGet( full, 'soap-env:Envelope.soap-env:Header[0].wsse:Security[0].wsse:BinarySecurityToken[0]._' );
        // If we don't have one, bail with an error
        if( _.isUndefined( securityToken ) ){
          return cb( 'Could not get the security token from Sabre.' );
        }
        // Set the security token and bail
        that.state.securityToken = securityToken;
        return cb( null, securityToken );
      } );
    };
    /**
     * Gets a quote for a hotel
     * @param object the data to send to the request
     * @param function the node callback function
     */
    this.HotelAvailability = function( data, cb ){
      // Make sure we've got a good data object
      if( !_.isPlainObject( data ) ){
        data = {};
      }

      // @todo Undo - for now just call create session
      this.CreateSession( function( err, token ){
        debugger;
      } );
    }
    /**
     * This function calls a service based on our templates
     * @param string the name of the service
     * @param object data the data we're going to need to make the call
     * @param function standard node callback function
     */
    this._callService = function( service, data, cb ){
      // Setup our default data
      var defaults = _.omit( this.config, 'uri' );
      // Setup our headers
      var headers = {
        'Content-Type': 'text/xml;charset=UTF-8',
        'SOAPAction': data.soapAction || 'OTA'
      };
      // Clone data so it's not linked to the calling function
      data = _.omit( data, 'soapAction' );
      // If we have a security token, add it to the data */
      if( this.state.securityToken ){
        data.securityToken = this.state.securityToken
      }
      // Update our data with the defaults
      _.assign( data, defaults );
      // Ok, let's try to compile the template now
      this._getTemplate( service, function( err, template ){
        if( !_.isNull( err ) ){
          return cb( err );
        }
        log.info( 'Calling service "' + service + '" with parameters:' );
        log.info( data );
        // Ok, generate our XML now from our template
        xml = template( data );
        // Make the request!
        request( that.config.uri, xml, function( err, response, body ){
          if( !_.isNull( err ) ){
            return cb( err );
          }
          xml2js.parseString( body, function( err, data ){
            if( !_.isNull( err ) ){
              return cb( err );
            }
            // So we have an object now, let's just return it from the service, with the body
            var body = _.deepGet( data, 'soap-env:Envelope.soap-env:Body[0]' );
            // If we don't have a body, bail
            if( _.isUndefined( body ) ){
              return cb( 'Could not parse body from the Sabre request.' );
            }
            // Return everything
            return cb( null, body, data, response );
        } );
        }, headers );
      } );
    };
    /**
     * This function builds a template, and returns it as a function
     * @param string template The templat we're going to pull
     * @param function cb The node callback function
     */
    this._getTemplate = function( template, cb ){
      /** Ok, if we have the item in our state object, and it is a function, return it */
      if( !_.isUndefined( that.state.templates[ template ] ) && _.isFunction( that.state.templates[ template ] ) ){
        log.info( 'Found precompiled handlebars template in state for: ' + template + '...' );
        return cb( null, that.state.templates[ template ] );
      }
      /** If we made it here, we need to read the template from the filesystem, and compile it with handlebars */
      var file = __dirname + '/templates/xml/' + template + '.xml.hbs';
      fs.readFile( file, { encoding: 'utf8' }, function( err, data ){
        if( !_.isNull( err ) ){
          return cb( err );
        }
        /** Ok, we have the file, let's pass it to our handlebars template func and return it */
        log.info( 'Generating handlebars template for: ' + template + '...' );
        that.state.templates[ template ] = handlebars.compile( data );
        return cb( null, that.state.templates[ template ] );
      } );
    };
    // Return ourself
    return this;
  };
  // Return the function
  return SabreDevStudioXml;
} )();

// Export our function
module.exports = SabreDevStudioXml
