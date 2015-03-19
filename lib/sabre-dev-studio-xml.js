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
    var async = require( 'async' );
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
      uri: 'https://webservices3.sabre.com', // Defaults to production
      conversationId: 'api+' + _.random( 1, 9999999 ) + '@travelbank.com'
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
     * @param number levelsIn The current number of levels we're in a possible loop
     * @param function cb Standard node callback
     */
    this.CreateSession = function( levelsIn, cb ){
      /** If we're not a number, make it so */
      if( !_.isNumber( levelsIn ) ){
        levelsIn = 0;
      }
      /** Just call the service directly, passing the callback function */
      this._callService( 'SessionCreateRQ', {
        soapAction: 'OTA'
      }, function( err, body, full, response ){
        if( err ){
          return cb( err );
        }
        var status = _.deepGet( body, 'SessionCreateRS[0].$.status' );
        // If we don't have a status of approved, something went wrong
        if( status != 'Approved' ){
          return cb( 'Could not CreateSession with Sabre for an unknown reason.' );
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
      }, levelsIn );
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
      // Go ahead and call the service now
      that._callService( 'OTA_HotelAvailLLSRQ', data, function( err, body, full, response ){
        if( err ){
          return cb( err );
        }
        console.log( body );
        debugger;
      } );
    }
    /**
     * This function calls a service based on our templates
     * @param string service The name of the service/action we're calling
     * @param object data The data we're going to need to make the call
     * @param function cb Standard node callback function
     * @param number levelsIn How many levels deep we've gotten
     */
    this._callService = function( service, data, cb, levelsIn ){
      // Make backups of our service and data
      var _service = _.clone( service );
      var _data = _.clone( data );
      // Setup our levels in if we don't have one
      if( !_.isNumber( levelsIn ) ){
        levelsIn = 1;
      }
      // If we have more than 5 levels in we should bail, we're not able to create a session
      if( levelsIn > 5 ){
        return cb( 'Too much recursion, could not call the ' + service + ' service, attempted ' + levelsIn + ' times...' );
      }
      // Setup our default data
      var defaults = _.omit( this.config, 'uri' );
      // Setup our headers
      var headers = {
        'Content-Type': 'text/xml;charset=UTF-8',
        'SOAPAction': data.soapAction || service
      };
      // Clone data so it's not linked to the calling function
      data = _.omit( data, 'soapAction' );
      // If we have a security token, add it to the data */
      if( this.state.securityToken ){
        data.securityToken = this.state.securityToken
      }
      // Add our action
      data.action = service;
      // Update our data with the defaults
      _.assign( data, defaults );
      // Ok, let's try to compile the template now
      this._getTemplate( service, function( err, template ){
        if( err ){
          return cb( err );
        }
        log.info( 'Calling service "' + service + '" with parameters:' );
        log.info( data );
        // Ok, generate our XML now from our template
        xml = template( data );
        // Make the request!
        request( that.config.uri, xml, function( err, response, body ){
          if( err ){
            return cb( err );
          }
          xml2js.parseString( body, function( err, data ){
            if( err ){
              return cb( err );
            }
            // So we have an object now, let's just return it from the service, with the body
            var body = _.deepGet( data, 'soap-env:Envelope.soap-env:Body[0]' );
            // If we don't have a body, bail
            if( _.isUndefined( body ) ){
              return cb( 'Could not parse body from the Sabre request.' );
            }
            // Try to get the fault code, and try different things as needed based on the code
            var faultCode = _.deepGet( body, 'soap-env:Fault[0].faultcode[0]' );
            if( faultCode ){
              var faultString = _.deepGet( body, 'soap-env:Fault[0].faultstring[0]' ) | faultCode;
              // Ok, if we need an auth token
              switch( faultCode ){
                case 'soap-env:Client.AuthenticationNotAllowed':
                case 'soap-env:Client.InvalidSecurityToken':
                  log.info( 'We need to get a new session: ' + faultCode + ': ' + faultString );
                  levelsIn = levelsIn + 1
                  // We need to get a session
                  that.CreateSession( levelsIn, function( err, securityToken ){
                    if( err ){
                      return cb( err );
                    }
                    // Ok, we're here, redo the same function call
                    that._callService.call( that, _service, _data, cb, levelsIn );
                  } );
                  // Just bail here
                  return;
                default:
                  return cb( faultString );
                  break;
              }
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
      async.series( {
        header: function( next ){
          fs.readFile( __dirname + '/templates/xml/_header.xml.hbs', { encoding: 'utf8' }, next );
        },
        body: function( next ){
          var file = __dirname + '/templates/xml/' + template + '.xml.hbs';
          fs.readFile( file, { encoding: 'utf8' }, next );
        },
        footer: function( next ){
          fs.readFile( __dirname + '/templates/xml/_footer.xml.hbs', { encoding: 'utf8' }, next );
        }
      }, function( err, results ){
        if( err ){
          return cb( err );
        }
        /** Ok, we have the file, let's pass it to our handlebars template func and return it */
        log.info( 'Generating handlebars template for: ' + template + '...' );
        that.state.templates[ template ] = handlebars.compile( results.header + results.body + results.footer );
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
