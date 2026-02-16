(function() {

    var scriptsParentElt = (document.getElementsByTagName("head")[0] || document.documentElement);
    var jQuery, $, ssoPopup, hiddenIframe, clearTokenIframe;
    var isSdkReady = false;

    if (!window['ClassyObjectName']) {
        // Happens when the old SDK snippet is used by a client. In this case, the ClassyObject was instantiated in the
        // global "Classy" variable.
        window['ClassyObjectName'] = 'Classy';
    }

    var ClassyObject = window[window['ClassyObjectName']];

    if (ClassyObject.params) {
        // The old sdk snippet already defines ClassyObject.clientId. The new sdk snippet passes it through the params
        // object.
        ClassyObject.clientId = ClassyObject.params.client_id;
        ClassyObject.appCookieName = ClassyObject.params.app_cookie_name;
        ClassyObject.oktaScope = ClassyObject.params.okta_scope;
        ClassyObject.oktaClientId = ClassyObject.params.okta_client_id;
        ClassyObject.redirect_uri = ClassyObject.params.redirect_uri;
        // Used for IDP login to return authorization code in the query params to exchanging the access token
        // otherwise access token available in the browser cookie
        ClassyObject.mode = ClassyObject.params.mode || null;
    }

    /**
     * The base_url is used for routing purposes as well as validating
     * the event.origin for messages posted to the iframe.
     *
     * The base_prefix is used to prefix routes with the appropriate sso
     * route prefix.
     */
    var base_url = ClassyObject.params.override_base_url || window.location.origin;
    var base_prefix = ClassyObject.params.override_base_prefix || "/sso";
    var appCookieName = ClassyObject.params.app_cookie_name || 'trident';

    // Injected on server side
    var live_app_origin = 'https://live.classy.org';
    var classy_origins  = 'https://www.classy.org'.split(' ');

    // Determine whether or not the Classy Live authentication token should be
    // cleared. For now, this is only true if the parent domain is a recognized
    // Classy domain. Domain masked sites are excluded, because they do not
    // share authentication state with the main Classy platform.
    function _shouldClearToken() {
        var this_origin = new URL(window.location).origin.toLowerCase();
        return classy_origins.includes(this_origin);
    }

    /**
     * Clears the Classy Live authentication token from local storage. This must
     * be done through an iframe and postMessage
     */
    function _clearToken(callback) {
        // Ensure callback is called exactly once
        var called = false;
        var tohandle = null;
        function ensure_callback(timedOut) {
            if (called) {
                return;
            }

            called = true;

            if (timedOut === true) {
                console.warn(window['ClassyObjectName'] + '.logout: Timed out waiting to clear token');
            } else {
                clearTimeout(tohandle);
            }
            callback();
        }

        if (clearTokenIframe == null) {
            // Clear token frame never initialized.
            ensure_callback();
            return;
        }

        // Don't wait more than 100ms for clear token mechanics
        tohandle = setTimeout(ensure_callback, 100, true);

        function handleMessage(e) {
            if (e.origin !== live_app_origin) {
                return;
            }
            if (e.data == null || e.data.type != 'token_cleared') {
                console.warn(window['ClassyObjectName'] + '.logout: Unexpected message: ' + JSON.stringify(e.data));
            }
            window.removeEventListener("message", handleMessage);
            ensure_callback();
        }

        window.addEventListener("message", handleMessage);

        // Post the message to tell the child page to clear the Classy Live authentication
        // token. It will respond with the token_cleared event handled above
        clearTokenIframe.contentWindow.postMessage({
            type: 'clear_token'
        }, live_app_origin);
    }

    /**
     * Opens a popup to initiate Oauth2 authorization code flow.
     */
    ClassyObject.login = function (options, callbackFunc) {
        alertIfSdkNotReady('login');

        // check if a connect popup is not already opened. Just bringing the popup to the foreground if that's the case.
        if ( typeof ssoPopup == 'undefined' || ssoPopup.closed ) {
            // Defining handler to receive popup message.
            var messageHandler = function(event) {
                // check origin - only accepting messages sent by login.classy.org
                if (event.origin == base_url) {
                    var message = JSON.parse(event.data);
                    if (message.idp_url || message.authorization_code || message.error) {
                        window.removeEventListener("message", messageHandler);
                        ssoPopup.postMessage('response_received', base_url); // acknowledging the response so that the popup can close itself.
                        if (typeof callbackFunc === 'string') {
                            window[callbackFunc](message);
                        } else if (typeof callbackFunc === 'function') {
                            callbackFunc(message);
                        }
                    }
                }
            };

            window.addEventListener("message", messageHandler, false);

            // opening popup
            var w = 400;
            var h = 700; // FIXME popup height should be automatically set based on popup content.
            var ww = $(window).width();
            var wh = $(window).height();
            var l = ww/2 - w/2;
            var t = wh/2 - h/2;

            options.method = 'popup';

            var url = buildAuthorizationUrl(options);
            var defaultParam = "no";
            var params = 'location=' + defaultParam + ', menubar=' + defaultParam + ', resizable=' + defaultParam + ', status=' + defaultParam + ', titlebar=' + defaultParam + ', height=' + h + ', top=' + t + ',left=' + l + ',width=' + w;

            ssoPopup = window.open(url, 'ClassyPopup', params);
        } else {
            ssoPopup.focus();
        }

        return false;
    };

    function logoutMparticleUser() {
        const getMparticleInstance = mParticle?.getInstance('classyinstance')
        if (getMparticleInstance) {
            getMparticleInstance?.Identity?.logout({})
        }
    }

    /**
     * Logout
     */
    ClassyObject.logout = function (callbackFunc) {
        alertIfSdkNotReady('logout');

        var doLogout = function() {
            $.ajax({
                url: base_url + base_prefix + "/logout",
                dataType: "jsonp",
                success: function() {
                    if (window?.mParticle) {
                        logoutMparticleUser();
                    }
                    callbackFunc();
                }
            });
        };

        if(_shouldClearToken()) {
            _clearToken(doLogout);
        } else {
            doLogout();
        }
    };

    /**
     * Generate iframe for login
     *
     * @param $iframeContainer HTML element that will contain the iframe
     * @param options SSO options. Ex: {"flow":"login_only", "campaign_id": "123", "...", "..."}.
     * @param callbackFunc Function executed once the user authenticated and granted access to the requesting app on SSO.
     * @private
     */
    function _createIframe($iframeContainer, options, callbackFunc) {
        options.method = 'iframe';
        var url = buildAuthorizationUrl(options);
        var $iframe = _fillIframeContainer($iframeContainer, url);

        var messageHandler = function(event) {
            // check origin - only accepting messages sent by login.classy.org
            if (event.origin == base_url) {

                if (event.data == '3rd_party_cookies_refused') {
                    $iframeContainer.empty();
                    window.removeEventListener("message", messageHandler);
                    _createFallbackIframe($iframeContainer, options, callbackFunc);
                    return;
                }

                var message;
                try {
                    message = JSON.parse(event.data);
                } catch(e) {}

                if (message && (message.idp_url || message.authorization_code || message.error)) {
                    window.removeEventListener("message", messageHandler);
                    if (typeof callbackFunc === 'string') {
                        window[callbackFunc](message);
                    } else if (typeof callbackFunc === 'function') {
                        callbackFunc(message);
                    }
                }
            }
        };

        window.addEventListener("message", messageHandler, false);
    }

    /**
     * In case SSO iframe method fails because of third party cookie being blocked by browser, this method
     * will load a simple login button in the iframe container, that will trigger SSO with the popup method.
     *
     * @param $iframeContainer HTML element that will contain the iframe
     * @param options SSO options. Ex: {"flow":"login_only", "campaign_id": "123", "...", "..."}.
     * @param callbackFunc Function executed once the user authenticated and granted access to the requesting app on SSO.
     * @private
     */
    function _createFallbackIframe($iframeContainer, options, callbackFunc) {
        var url = buildAuthorizationUrl(options, 'fallback_iframe');
        var $iframe = _fillIframeContainer($iframeContainer, url);

        // $iframe.click() & $iframeContainer.click() won't work. Can't bind onclick events to iframes
        // apparently. Or maybe that's because the content of the iframe is on an other domain.
        // Anyway: overlaying the iframe with a transparent div on which we'll bind the onclick event.
        $('<div>')
            .css({
                'position': 'absolute',
                'width': '100%',
                'height': '100%',
                'left': 0,
                'top': 0,
                'cursor': 'pointer'
            })
            .click(function() {
                Classy.login(options, function(SSO_response) {
                    $iframeContainer.empty();
                    if (typeof callbackFunc === 'string') {
                        window[callbackFunc](SSO_response);
                    } else if (typeof callbackFunc === 'function') {
                        callbackFunc(SSO_response);
                    }
                });
            })
            .appendTo($iframeContainer.css('position', 'relative'));
    }

    /**
     * Populates an HTML container, `$iframeContainer`, with an iframe displaying a page hosted at `url`
     * Make iframe resizer automatically set the iframe height based on its content.
     *
     * @param $iframeContainer
     * @param url
     * @returns {jQuery} The created iframe.
     * @private
     */
    function _fillIframeContainer($iframeContainer, url) {
        $iframeContainer.empty();

        var $iframe = $('<iframe>', {
            src: url,
            scrolling: 'no',
            frameborder: 0,
            width: '100%',
            allowtransparency: true
        }).appendTo($iframeContainer);

        var isOldIE = (navigator.userAgent.indexOf("MSIE") !== -1); // Detect IE10 and below

        if (typeof iFrameResize === 'function') {
            $iframe.on('load', function () {
                iFrameResize({
                    log: false,
                    heightCalculationMethod: isOldIE ? 'max' : 'taggedElement'
                }, $iframe[0]);
            });
        }

        return $iframe;
    }

    /**
     * Parse Dom on demand
     */
    ClassyObject.parseDom = function (callbackFunc) {
        alertIfSdkNotReady('parseDom');

        // Binding ClassyObject.login() method to elements with "classy-login-btn" class.
        $('a.classy-login-btn').not('.classy-parsed').addClass('classy-parsed').click(function () {
            var options = {};
            options.scope = $(this).data('scope') ? $(this).data('scope') : 'read_profile';
            options.org_id = $(this).data('org_id') ? $(this).data('org_id') : null;
            options.layout = $(this).data('layout') ? $(this).data('layout') : null;
            options.flow = $(this).data('flow') ? $(this).data('flow') : null;
            options.campaign_id = $(this).data('campaign_id') ? $(this).data('campaign_id') : null;
            var callback = typeof callbackFunc === "function" ? callbackFunc : $(this).data('callback');
            ClassyObject.login(options, callback);
            return false;
        });

        // Creating sso iframe if any placeholder is defined
        $('div.classy-login-iframe').not('.classy-parsed').addClass('classy-parsed').each(function() {
            var options = {};
            options.scope = $(this).data('scope') ? $(this).data('scope') : 'read_profile';
            options.org_id = $(this).data('org_id') ? $(this).data('org_id') : null;
            options.layout = $(this).data('layout') ? $(this).data('layout') : null;
            options.flow = $(this).data('flow') ? $(this).data('flow') : null;
            options.campaign_id = $(this).data('campaign_id') ? $(this).data('campaign_id') : null;
            options.original_url = $(this).data('original_url') ? $(this).data('original_url') : null;
            options.password_reset_code = $(this).data('password_reset_code') ? $(this).data('password_reset_code') : null;
            options.member_id = $(this).data('member_id') ? $(this).data('member_id') : null;
            // This variable is used to generate the password reset url in the way that angularjs waiting for.
            // AngularJs have a problem with the router that can handle the querystring before the #, with this parameter
            // the backend will know how to generate the correct url.
            options.is_angularjs_mode = $(this).data('is_angularjs_mode') ? $(this).data('is_angularjs_mode') : null;

            var callback = typeof callbackFunc === "function" ? callbackFunc : $(this).data('callback');
            _createIframe($(this), options, callback);
        });
    };

    /**
     * Gets the user session state on login.classy.org
     * `response` if of the form:
     * {
     *     is_logged_in: true,
     *     has_authorized: false
     * }
     */
    ClassyObject.status = function(callbackFunc) {
     alertIfSdkNotReady('status');
     $.ajax({
        url: base_url + base_prefix + "/status?client_id=" + encodeURIComponent(ClassyObject.clientId),
        dataType: "jsonp",
        success: function(response) {
         if (response.is_logged_in && window?.mParticle) {
           initMparticleUser();
         }
         callbackFunc(response);
        }
      });
    };

    /**
    * Handles the logic after user is logged in
    * Calls /me endpoint to get user info and sets mParticle user and attributes
    */
    async function initMparticleUser() {
     try {
        const res = await fetch(`${base_url}${base_prefix}/me`);
        const user = await res.json();

        if (res.status !== 200 || !user) { return }

        const mParticleInstance = mParticle?.getInstance('classyinstance');

        if (mParticleInstance) {
            let mParticleUser = mParticleInstance.Identity?.getCurrentUser();
            const isCurrentUserLoggedIn = (mParticleUser?.getAllUserAttributes()?.email === user.email_address);

            const identityRequest = {
              userIdentities: {
                ...(user.id && { other: user.id.toString() }),
                ...(user.email_address && { email: user.email_address }),
                ...(user.phone && { mobile_number: user.phone.toString().replace(/[^0-9]/g, '') })
              }
            };

            if (!mParticleUser || !isCurrentUserLoggedIn) {
              // User needs to be logged in via mParticle Identity
              // Identity.login() will automatically log a login event with identities
              if (Object.keys(identityRequest.userIdentities).length) {
                const result = await mParticleInstance.Identity?.login(identityRequest);
                mParticleUser = result?.getUser?.() || mParticleInstance.Identity?.getCurrentUser();
              }
            } else {
              // User is already logged in to mParticle
              // Update identities using modify() and manually log the "signed in" event
              if (Object.keys(identityRequest.userIdentities).length) {
                await mParticleInstance.Identity?.modify(identityRequest);
              }

              const attributes = {
                platform_source: "web client",
                page_title: document.title || "unknown",
                page_url: window.location.href || "unknown",
                page_referrer: document.referrer || "unknown",
                logged_in_state: "logged in",
                surface: "gfm pro login",
                mp_device_id: mParticleInstance.getDeviceId() || "unknown"
              };

              mParticleInstance.logEvent('signed in', mParticleInstance.EventType.Navigation, attributes);
            }

            if (mParticleUser) {
             setMParticleAttributes(mParticleUser, user);
            }
        }
      } catch (e) {
      console.error(e);
      }
    }

    /**
    * Sets mParticle user attributes from API user object
    */
    function setMParticleAttributes(mParticleUser, user) {

       if (!mParticleUser || !user) return;

       const setAttrIfExists = (key, value) => {
            if (value !== undefined && value !== null && value !== "") {
                if (Array.isArray(value)) {
                    mParticleUser.setUserAttributeList(key, value);
                } else {
                    mParticleUser.setUserAttribute(key, value);
                }
            }
        };

       setAttrIfExists("member_id", user.id);
       setAttrIfExists("email", user.email);
       setAttrIfExists("user_created_date", user.user_created_date);
       setAttrIfExists("$Country", user.country);
       setAttrIfExists("$State", user.state);
       setAttrIfExists("$FirstName", user.first_name);
       setAttrIfExists("$LastName", user.last_name);
       setAttrIfExists("roles", user.role);
       setAttrIfExists("$Mobile", user.mobile);
       setAttrIfExists("$Zip", user.zip);
    }

    /******** Load jQuery *********/
    loadScript('https://code.jquery.com/jquery-3.6.1.min.js', function() {
        // Restore $ and window.jQuery to their previous values and store the
        // new jQuery in our local jQuery variable
        jQuery = window.jQuery.noConflict(true);
        $ = jQuery;

        // Call our main function
        init();
    });

    /**
     * Dynamically & asynchronously loads a js script located at src. Trigger callback function once script is
     * loaded.
     */
    function loadScript(src, callback) {
        var script_tag = document.createElement('script');

        if(callback) {
            script_tag.onload = callback;
        }

        script_tag.setAttribute("type","text/javascript");
        script_tag.setAttribute("src", src);
        script_tag.setAttribute('crossorigin', true);
        scriptsParentElt.appendChild(script_tag);
    }

    /**
     * Init script. Will parse the document and bind Classy login method to buttons and/or iframe if present.
     */
    function init() {
        // exposing the jquery object used by the SDK
        ClassyObject.$ = $;

        function callback() {
            isSdkReady = true;

            if (!ClassyObject.params.skip_dom_parsing) {
                ClassyObject.parseDom();
            }

            executeReadyCallbacks();
        }

        if (!ClassyObject.params.skip_iframe_resizer) { // Support skipping of the loading iFrameResizer (classyapp - dev)
            $.ajax({
                url: base_url + base_prefix + "/ssobuild/js/iframeResizer.e5ecb41d52df30868660ebede6c2c531.js",
                dataType: "script",
                cache: true,
                success: callback
            });
        } else {
            callback();
        }

    }

    function getCookie(name) {
        let cookie = {};
        document.cookie.split(';').forEach(function (el) {
            let [k, v] = el.split('=')
            cookie[k.trim()] = v
        });

        return cookie[name]
    }

    /**
     * Making available to SDK consumers. Helper to get cookie value for the given name.
     */
    ClassyObject.getCookie = getCookie

    function executeReadyCallbacks(){
        if (ClassyObject.onReady) {
            if (typeof ClassyObject.onReady === 'function') {
                console.warn('Classy Login - You are using an old version of javascript snippet. Please upgrade!');

                ClassyObject.onReady = [ClassyObject.onReady];
            }

            ClassyObject.onReady.forEach(executeReadyCallback);
        }

        // making sure that any new call to Classy.ready(callback) will execute callback() right away.
        ClassyObject.ready = executeReadyCallback;
    }

    function executeReadyCallback(callback) {
        if (typeof callback === 'function') {
            window.setTimeout(callback);
        } else {
            console.warn(window['ClassyObjectName'] + '.ready() expects a callback.');
        }
    }

    /**
     * Helper to generate the url toward the authorize endpoint.
     *
     * @param options.scope comma separated list of requested scopes
     * @param options.method SSO method used. Can be "iframe", "popup" or "redirect"
     * @param options.org_id To be set when SSO must be styled with an organization branding.
     * @param options.layout "v1" or "v2" to choose between the legacy or the new Classy look and feel.
     * @param options.flow "login", "signup" or "login_only" indicates which form are displayed by default. login_only => the user can't signup.
     * @param options.state A value to be returned in the token. The client application can use it to remember the state of its interaction with the end user at the time of the authentication call.
     */
    function buildAuthorizationUrl(options, path) {
        path = path || 'authorize';

        var url = base_url + base_prefix + '/' + path + '?';
        url += '&response_type=code';
        url += '&client_id=' + encodeURIComponent(ClassyObject.clientId);
        url += '&scope=' + encodeURIComponent(options.scope);

        if (ClassyObject.oktaClientId) {
            url += '&okta_client_id=' + ClassyObject.oktaClientId;
        }

        if (ClassyObject.redirect_uri) {
            url += '&redirect_uri=' + encodeURIComponent(ClassyObject.redirect_uri)
        }

        if (ClassyObject.oktaScope) {
            url += '&okta_scope=' + ClassyObject.oktaScope;
        }

        if (ClassyObject.appCookieName) {
            url += '&app_cookie_name=' + ClassyObject.appCookieName;
        }

        if (ClassyObject.mode) {
            url += '&mode=' + ClassyObject.mode;
        }

        if (options.method) {
            url += '&sso_method=' + options.method;
        }

        if (options.campaign_id) {
            url += '&campaign_id=' + encodeURIComponent(options.campaign_id);
        }

        if (options.org_id) {
            url += '&org_id=' + encodeURIComponent(options.org_id);
        }

        if (options.layout) {
            url += '&layout=' + encodeURIComponent(options.layout);
        }

        if (options.flow) {
            url += '&flow=' + encodeURIComponent(options.flow);
        }

        if (options.original_url ) {
            url += '&original_url=' + encodeURIComponent(options.original_url);
        }

        if (options.password_reset_code) {
            url += '&password_reset_code=' + encodeURIComponent(options.password_reset_code);
        }

        if (options.member_id) {
            url += '&member_id=' + encodeURIComponent(options.member_id);
        }

        if (options.is_angularjs_mode) {
            url += '&is_angularjs_mode=' + encodeURIComponent(options.is_angularjs_mode);
        }

        if (options.state) {
            url += '&state=' + encodeURIComponent(options.state);
        }

        return url;
    }

    /**
     * Making available to SDK consumers. Helper to generate the url toward the authorize endpoint.
     */
    ClassyObject.buildAuthorizationUrl = buildAuthorizationUrl

    function alertIfSdkNotReady(methodCalled) {
        if (!isSdkReady) {
            console.warn(window['ClassyObjectName'] + "." + methodCalled + "() should be called within a callback passed to " + window['ClassyObjectName'] + ".ready().");
        }
    }

    function resetIframe () {
        $(window).off('message');

        if (hiddenIframe) {
            hiddenIframe.remove();
            hiddenIframe = null;
        }
    }

    /**
     * Submit a form using the hidden iframe.
     */
    function submitForm (action, payload, cb) {
        resetIframe();

        var iframeUrl = base_url + base_prefix + '/hidden_iframe';
        var origin = window.location.protocol + '//' + window.location.hostname + (window.location.port ? ':' + window.location.port : '');

        hiddenIframe = $('<iframe src="' + iframeUrl + '"></iframe>').hide();

        var timeout = setTimeout(function () {
            resetIframe();
            cb({ error: 'ERR_TIMED_OUT' });
        }, 30000);

        function handler (e) {
            if (e.originalEvent.origin !== base_url) return;
            var response = JSON.parse(e.originalEvent.data);

            if (response.status === 'ready') {
                hiddenIframe[0].contentWindow.postMessage(JSON.stringify({
                    action: action,
                    clientId: ClassyObject.clientId,
                    payload: payload,
                    origin: origin
                }), base_url);
            }
            else {
                resetIframe();
                clearTimeout(timeout);
                cb(response.data);
            }
        }

        $(window).on('message', handler);
        hiddenIframe.appendTo('body');
    }

    function checkRequired (payload, inputs) {
        var missingFields = [];

        for (var i=0; i < inputs.length; i++) {
            if (!payload[inputs[i]]) {
                missingFields.push(inputs[i]);
            }
        }

        return missingFields.length ? missingFields : false;
    }

    /**
     * Process signup using hidden iframe.
     */
    ClassyObject.submitSignupForm = function(payload, cb) {
        alertIfSdkNotReady('submitSignupForm');

        if (!cb || typeof cb !== 'function') {
            throw new Error(window['ClassyObjectName'] + ".submitSignupForm() requires a callback.");
        }

        if (typeof payload !== 'object') {
            cb({ error: 'ERR_MALFORMED_PAYLOAD' });
            return;
        }

        var missingFields = checkRequired(payload, ['firstName', 'lastName', 'email', 'password']);

       if (missingFields) {
            cb({
                error: 'ERR_VALIDATION_ERROR',
                missingFields: missingFields
            });
            return;
        }

        submitForm('signup', payload, cb);
    };

    /**
     * Process login using hidden iframe.
     */
    ClassyObject.submitLoginForm = function(payload, cb) {
        alertIfSdkNotReady('submitLoginForm');

        if (!cb || typeof cb !== 'function') {
            throw new Error(window['ClassyObjectName'] + ".submitLoginForm() requires a callback.");
        }

        if (typeof payload !== 'object') {
            cb({ error: 'ERR_MALFORMED_PAYLOAD' });
            return;
        }

        var missingFields = checkRequired(payload, ['email', 'password']);

        if (missingFields) {
            cb({
                error: 'ERR_VALIDATION_ERROR',
                missingFields: missingFields
            });
            return;
        }

        submitForm('login', payload, cb);
    };

    ClassyObject.refreshToken = async function (payload) {
        try {
            const clientId = payload.clientId || ClassyObject.clientId;
            const refreshToken = payload.refreshToken;
            const body = {
                client_id: clientId,
                refresh_token: payload.refreshToken
            };
            const response = await fetch(
                `${base_url}${base_prefix}/refresh-token`,
                {
                    credentials: "include",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(body)
                }
            );
            if (response.status !== 200) {
                return { "error": response.statusText, "message": "Unable to refresh the token"};
            }

            return await response.json();
        } catch(e) {
            console.error('Refresh Token failed', e);
        }
    }

})();
