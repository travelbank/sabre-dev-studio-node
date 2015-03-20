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
    var md5 = require( 'MD5' );
    var jsonfile = require( 'jsonfile' );
    var _ = require( 'lodash' );
    var bunyan = require( 'bunyan' );
    var fileExists = require( 'file-exists' );
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
      fixtures: false
    };
    // Holds our state object
    this.state = {
      // Our security tokens
      // Holds an object composed of
      // securityToken: { token: [token], inUse: false/true }
      securityTokens: {},
      // Holds our handlebars compiled templates
      templates: {}
    };
    // Do some init stuff
    _.assign( this.config, options );
    log.info( 'Initializing SabreDevStudioXml with config:' );
    log.info( this.config );
    if( this.config.fixtures ){
      log.info( 'Fixtures enabled...' );
    }
    /**
     * Closes a session, anything that calls this shouldn't expect a response
     * @param string securityKey The session we're closing with
     */
    this.CloseSession = function( securityToken, cb ){
      if( !_.isString( securityToken ) ){
        return;
      }
      if( typeof cb != 'function' ){
        cb = function(){ return; };
      }
      /** If the object's not there, we don't need to actually do anything, it's already been taken care of */
      if( _.isUndefined( that.state.securityTokens[ md5( securityToken ) ] ) ){
        return cb();
      }
      /** Remove the security key */
      that._removeSecurityToken( securityToken, function( err ){
        /** Just call the service directly, passing the callback function */
        that._callService( 'SessionCloseRQ', {
          soapAction: 'OTA',
          securityToken: securityToken
        }, function( err, body, full, response ){
          /** Do nothing, just return */
          return cb();
        } );
      } );
    };
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
      /** Generate a new conversation */
      this._generateNewConversationId();
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
        that._addSecurityToken( securityToken, function( err ){
          if( err ){
            return cb( err );
          }
          // Go ahead and use our callback
          return cb( null, securityToken );
        } );
      }, levelsIn );
    };
    /**
     * Gets actual room quotes from the Sabre API, needs to have a hotelCode
     * @param object data The data we'll pass through, must validate!
     * @param function cb The node callback function
     */
    this.HotelPropertyDescription = function( data, cb ){
      // Make sure we've got a good data object
      if( !_.isPlainObject( data ) ){
        data = {};
      }
      var _data = _.clone( data );
      // Create our handler
      var handler = function( err, body, full, response, levelsIn ){
        // See if we have success first
        var status = _.deepGet( body, 'HotelPropertyDescriptionRS[0].stl:ApplicationResults[0].$.status' );
        if( status != 'Complete' ){
          // Do it again
          return that._callService( 'HotelPropertyDescriptionLLSRQ', _data, handler, levelsIn );
        }
        // Get our room rates
        var roomRates = _.deepGet( body, 'HotelPropertyDescriptionRS[0].RoomStay[0].RoomRates[0].RoomRate' );
        // If we don't have a valid one, bail */
        if( !( _.isArray( roomRates ) && roomRates.length ) ){
          return cb( 'No room rates were found for this hotel...' );
        }
        // Our array is valid, pass it back
        return cb( null, roomRates, body );
      };
      // Go ahead and call the service now
      that._callService( 'HotelPropertyDescriptionLLSRQ', data, handler );
    };
    /**
     * Gets a quote for a hotel
     * @param object data The data we'll pass through, must validate!
     * @param function cb The node callback function
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
        /** Check for errors in the XML body */
        err = _.deepGet( body, 'OTA_HotelAvailRS[0].stl:ApplicationResults[0].stl:Error[0].stl:SystemSpecificResults[0].stl:Message[0]' );
        /** If we have an error, callback with it */
        if( err ){
          return cb( err );
        }
        /** Make sure we have a good status message */
        var status = _.deepGet( body, 'OTA_HotelAvailRS[0].stl:ApplicationResults[0].$.status' );
        if( status != 'Complete' ){
          return cb( 'Unknown status returned from hotel search: ' + status )
        }
        /** Get the hotels array from the body content */
        var hotels = _.deepGet( body, 'OTA_HotelAvailRS[0].AvailabilityOptions[0].AvailabilityOption' );
        if( !_.isArray( hotels ) && hotels.length ){
          return cb( 'Did not get any hotel results' );
        }
        /** Ok, we have a valid array of hotels, let's just return the response from here */
        return cb( null, hotels, body );
      } );
    };
    /**
     * Adds and removes from the session tokens array
     */
    this._addSecurityToken = function( securityToken, cb ){
      if( typeof cb != 'function' ){
        cb = function(){ return; };
      }
      var hash = md5( securityToken );
      // Go ahead and do it locally, too
      var actualToken = {
        token: securityToken,
        inUse: false,
        updated: Math.floor( Date.now() / 1000 )
      };
      that.state.securityTokens[ hash ] = actualToken;
      log.info( 'Added security token: ' + hash );
      return cb();
    };
    this._setSecurityTokenProperty = function( securityToken, key, value, cb ){
      if( typeof cb != 'function' ){
        cb = function(){ return; };
      }
      var hash = md5( securityToken );
      log.info( 'Setting security token key/value: ' + hash + '::' + key + '=' + value );
      // Go ahead and do it locally, too
      if( !_.isUndefined( that.state.securityTokens[ hash ] ) ){
        that.state.securityTokens[ hash ][ key ] = value;
        that.state.securityTokens[ hash ].updated = Math.floor( Date.now() / 1000 );
      }
      // Bail
      return cb();
    };
    this._removeSecurityToken = function( securityToken, cb ){
      if( typeof cb != 'function' ){
        cb = function(){ return; };
      }
      var hash = md5( securityToken );
      log.info( 'Removed security token: ' + hash );
      // Do it locally first
      var newTokens = {};
      for( var key in that.state.securityTokens ){
        if( hash != key ){
          newTokens[ key ] = _.clone( that.state.securityTokens[ key ] );
        }
      }
      // Update the property
      that.state.securityTokens = newTokens;
      // Bail
      return cb();
    };
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
        levelsIn = 0;
      }
      // Increase our count
      levelsIn = levelsIn + 1;
      // If we have more than 5 levels in we should bail, we're not able to create a session
      if( levelsIn > 5 ){
        return cb( 'Too much recursion, could not call the ' + service + ' service, attempted ' + levelsIn + ' times...' );
      }
      // If we don't have a conversation ID, it needs to be added
      if( !_.isString( that.config.conversationId ) ){
        that._generateNewConversationId();
      }
      // Backup the number of tokens
      var tokenLimit = this.config.tokenLimit;
      // Setup our default data
      var defaults = _.omit( this.config, [ 'uri', 'fixtures', 'tokenLimit' ] );
      // Setup our headers
      var headers = {
        'Content-Type': 'text/xml;charset=UTF-8',
        'SOAPAction': data.soapAction || service
      };
      // Clone data so it's not linked to the calling function
      data = _.omit( data, 'soapAction' );
      if( !_.isString( data.securityToken ) ){
        var activeTokens = _.where( _.clone( that.state.securityTokens ), { inUse: false } );
        if( activeTokens.length ){
          log.info( 'We have some active tokens, picking one by random...' );
          var myToken = _.first( activeTokens );
          // Changing the token to inUse
          that._setSecurityTokenProperty( myToken.token, 'inUse', true );
          // Saving it for this particular request
          data.securityToken = myToken.token;
        }else if( _service != 'SessionCreateRQ' && _service != 'SessionCloseRQ' ){
          // So, we have to have an active session, let's gen one
          log.info( 'We need a Security Token to make a request!' );
          that.CreateSession( levelsIn, function( err, securityToken ){
            if( err ){
              return cb( err );
            }
            // Ok, we're here, redo the same function call
            that._setSecurityTokenProperty( securityToken, 'inUse', true, function( err ){
              _data.securityToken = securityToken;
              // Ok, we're here, redo the same function call
              that._callService.call( that, _service, _data, cb, levelsIn );
            } );
          } );
          // Just bail here
          return;
        }
      }
      // Add our action; and setup the fixture file
      data.action = service;
      var fixtureFile = __dirname + '/fixtures/xml/' + service + '.json';
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
        var xml = template( data );
        // Create our callback function
        var requestCallback = function( err, response, body ){
          // If we have a token, we need to do something with it
          if( !_.isUndefined( that.state.securityTokens[ md5( data.securityToken ) ] ) ){
            // If we have too many security tokens, delete this one
            if( _.size( that.state.securityTokens ) >= tokenLimit ){
              that.CloseSession( data.securityToken );
            }else {
              // Else we just toggle it back to available
              that._setSecurityTokenProperty( data.securityToken, 'inUse', false );
            }
          }
          if( err ){
            return cb( err );
          }
          // Save our args for later storage in fixtures
          var _args = _.toArray( arguments );
          xml2js.parseString( body, function( err, object ){
            if( err ){
              return cb( err );
            }
            // So we have an object now, let's just return it from the service, with the body
            var body = _.deepGet( object, 'soap-env:Envelope.soap-env:Body[0]' );
            // If we don't have a body, bail
            if( _.isUndefined( body ) ){
              return cb( 'Could not parse body from the Sabre request.' );
            }
            // Try to get the fault code, and try different things as needed based on the code
            var faultCode = _.deepGet( body, 'soap-env:Fault[0].faultcode[0]' );
            if( faultCode ){
              var faultString = _.deepGet( body, 'soap-env:Fault[0].faultstring[0]' ) || faultCode;
              // Ok, if we need an auth token
              switch( faultCode ){
                case 'soap-env:Client.AuthenticationNotAllowed':
                case 'soap-env:Client.InvalidSecurityToken':
                  // If there's a current access token that we used, remove it
                  if( _service != 'SessionCloseRQ' && !_.isUndefined( data.securityToken ) ){
                    log.info( 'We need to get a new session: ' + faultCode + ': ' + faultString );
                    log.info( 'Invalid security token, removing: ' + md5( data.securityToken ) );
                    that._removeSecurityToken( data.securityToken );
                  }
                  // We need to get a session, but only if we aren't on the 'close/open session' requests
                  if( _service != 'SessionCloseRQ' && _service != 'SessionCreateRQ' ){
                    that.CreateSession( levelsIn, function( err, securityToken ){
                      if( err ){
                        return cb( err );
                      }
                      // Ok, we're here, redo the same function call
                      that._setSecurityTokenProperty( securityToken, 'inUse', true, function( err ){
                        _data.securityToken = securityToken;
                        that._callService.call( that, _service, _data, cb, levelsIn );
                      } );
                    } );
                  }
                  // Just bail here
                  return;
                default:
                  return cb( faultString );
                  break;
              }
            }
            // Success, write that fixture!
            if( that.config.fixtures && !fileExists( fixtureFile ) ){
              try{
                log.info( 'Attempting to write fixture file now...' );
                jsonfile.writeFileSync( fixtureFile, _args );
              } catch( err ){
                log.info( 'Could NOT write fixture file :(...' );
              }
            }
            // Return everything
            return cb( null, body, object, response, levelsIn );
          } );
        } ;
        // If we're using fixtures, try to find them first
        if( that.config.fixtures ){
          try{
            // Try to require the args JSON file
            log.info( 'Trying to find fixture: ' + fixtureFile );
            var fixture = jsonfile.readFileSync( fixtureFile );
            // Call the request callback with the fixtures from the JSON file and bail
            log.info( 'Fixture found! Calling callback function.' );
            return requestCallback.apply( that, fixture );
          }catch( err ){
            log.info( 'Could find/open the fixture file... :(' );
          }
        }
        // Make the normal request!
        return request( that.config.uri, xml, requestCallback, headers );
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
    /**
     * Generates a new conversation ID for us, and saves it to our config
     */
    this._generateNewConversationId = function(){
      var conversationId = 'api+' + _.random( 1, 9999999 ) + '@travelbank.com';
      that.config.conversationId = conversationId;
      log.info( 'Generated new conversation ID: ' + conversationId );
      return conversationId;
    };
    // Return ourself
    return this;
  };
  // Return the function
  return SabreDevStudioXml;
} )();

// Export our function
module.exports = SabreDevStudioXml
