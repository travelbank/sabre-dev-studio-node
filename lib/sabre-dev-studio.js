/*
 * sabre-dev-studio
 * https://github.com/SabreLabs/sabre-dev-studio-node
 *
 * Copyright (c) 2014 Sabre Corp
 * Licensed under the MIT license.
 */

'use strict';
var SabreDevStudio = (function () {
  function SabreDevStudio(options) {
    var that = this
      , loglevel = options.loglevel || 'warn'
      , url = require('url')
      , OAuth = require('oauth')
      , bunyan = require('bunyan')
      , log = bunyan.createLogger({name: 'SabreDevStudio', level: loglevel})
      , oauth2 = null
      , errorCodes = {
        400: 'BadRequest',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'NotFound',
        406: 'NotAcceptable',
        429: 'RateLimited',
        500: 'InternalServerError',
        503: 'ServiceUnavailable',
        504: 'GatewayTimeout'
      }
      ;
    delete options.loglevel;
    this.config = {};
    init(options);

    function init(options) {
      var clientID = function () {
        return new Buffer(that.config.client_id).toString('base64');
      };
      var clientSecret = function () {
        return new Buffer(that.config.client_secret).toString('base64');
      };
      var credentials = function () {
        return new Buffer(clientID() + ':' + clientSecret()).toString('base64');
      };
      var keys = ['client_id', 'client_secret', 'uri', 'access_token'];
      keys.forEach(function (key) {
        that.config[key] = options[key];
      });
      oauth2 = new OAuth.OAuth2(
        clientID(),
        clientSecret(),
        that.config.uri,
        null,
        '/v1/auth/token',
        {'Authorization': 'Basic ' + credentials()}
      );
      oauth2.useAuthorizationHeaderforGET(true);
    }

    this.get = function (endpoint, options, callback, retryCount) {
      var requestUrl = url.parse(that.config.uri + endpoint);
      requestUrl.query = options;
      requestUrl = url.format(requestUrl);

      that._request('GET', requestUrl, {}, callback, retryCount);
    };

    this.post = function (endpoint, options, callback, retryCount) {
      var requestUrl = url.parse(that.config.uri + endpoint);
      requestUrl = url.format(requestUrl);
      options = options || {};

      that._request('POST', requestUrl, options, callback, retryCount);
    };

    this._request = function (method, requestUrl, options, callback, retryCount) {
      retryCount = retryCount || 0;
      var cb = callback || function (error, data) {
          log.info(error, data);
        };
      var fetchAccessToken = function (method, requestUrl, options, cb) {
        log.info('Fetching fresh access token');
        oauth2.getOAuthAccessToken(
          '',
          {'grant_type': 'client_credentials'},
          function (error, access_token) {
            if (error) {
              var error_data = JSON.parse(error.data);
              var err = new Error(error.statusCode + ': ' + errorCodes[error.statusCode] + ': ' + error_data.error + ': ' + error_data.error_description);
              log.error('Error:', err);
              cb(err, null, null);
            } else {
              that.config.access_token = access_token;
              that._request(method, requestUrl, options, cb, retryCount);
            }
          }
        );
      };
      if (that.config.access_token) {
        that._oauth2Request(method, requestUrl, options, that.config.access_token, function (error, data, response) {
          if (!error && response.statusCode === 200) {
            cb(null, data, response);
          } else if (error.statusCode === 401 && retryCount < 1) {
            fetchAccessToken(method, requestUrl, options, cb);
          } else {
            if (error.data === '') {
              error.data = requestUrl;
            }
              var error_data = JSON.parse(error.data);
            var err = new Error(error.statusCode + ': ' + errorCodes[error.statusCode] + ': ' + error_data.error + ': ' + error_data.error_description);
            log.error('Error:', err);
            cb(err, error.data, response);
          }
        });
      } else {
        fetchAccessToken(method, requestUrl, options, cb);
      }
    };

    this._oauth2Request = function (method, url, postData, accessToken, callback) {
      var headers = {};
      method = method || 'GET';
      if (method === 'POST') {
        headers = {'Content-Type': 'application/json'};
        postData = JSON.stringify(postData);
      } else {
        postData = false;
      }

      if (oauth2._useAuthorizationHeaderForGET) {
        headers['Authorization'] = oauth2.buildAuthHeader(accessToken);
        accessToken = null;
      }

      oauth2._request(method, url, headers, postData, accessToken, callback);
    };
  }

  return SabreDevStudio;
})();

module.exports = SabreDevStudio;
