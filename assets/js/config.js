const apiurl = window.location.origin + '/api';
document.title = "Bvox";


function loadScript(url, callback) {
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = url;
    if (callback) {
        script.onload = callback;
    }
    document.head.appendChild(script);
}

function translateGaibian(gaibian) {
    const translations = {
        1: gy('Seconds contract order'),
        2: gy('Seconds settlement'),
        3: gy('Top-up'),
        4: gy('Withdrawal'),
        5: gy('Buy AI arbitrage'),
        6: gy('AI arbitrage income'),
        7: gy('AI set recycling'),
        8: gy('Cash out'),
        9: gy('Cash in'),
        21: gy('System increase'),
        22: gy('System deduction'),
        23: gy('Withdrawal rejected'),
        24: gy('Mining pledge'),
        25: gy('Mining income'),
        26: gy('Loan transfer in'),
        27: gy('Mining redemption')
    };
    return translations[gaibian] || '';
}

(function() {
    window.alert = function (message) {
    // 避免重复弹窗
    if (document.querySelector('#customAlertBox')) return;

    const alertBox = document.createElement('div');
    alertBox.id = 'customAlertBox';
    alertBox.innerText = 'Bvox Notice\n\n' + message;

    // 设置内联样式（含换行控制）
    Object.assign(alertBox.style, {
      position: 'fixed',
      top: '30%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      backgroundColor: '#fff',
      color: '#000',
      border: '1px solid #ccc',
      borderRadius: '10px',
      padding: '20px 30px',
      zIndex: '9999',
      boxShadow: '0 0 10px rgba(0, 0, 0, 0.2)',
      fontFamily: 'Arial, sans-serif',
      textAlign: 'center',
      maxWidth: '80%',
      wordBreak: 'break-word',    // ✅ 自动换行
      overflowWrap: 'break-word', // ✅ 防止长串不换行
      lineHeight: '1.5'
    });

    const btn = document.createElement('button');
    btn.innerText = 'OK';
    Object.assign(btn.style, {
      marginTop: '15px',
      padding: '6px 16px',
      backgroundColor: '#007bff',
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px'
    });

    btn.onclick = function () {
      alertBox.remove();
    };

    alertBox.appendChild(document.createElement('br'));
    alertBox.appendChild(btn);
    document.body.appendChild(alertBox);
  };
})();


// Scripts are now loaded directly in HTML files from /assets/js/
// Removed duplicate document.write() calls to prevent double-loading


window.addEventListener('load', async () => {
    $('a').on('click', function(event) {
        event.preventDefault();
        const link = $(this).attr('href');
        $('html').addClass('fade-out');
        setTimeout(() => {
            window.location.href = link;
        }, 300); // 过渡时间
    });

    setFontSize();
    // Ensure a userid cookie exists; default to '0' when missing
    try {
        if (!Cookies.get('userid')) Cookies.set('userid', '0', { expires: 365 });
    } catch (e) {}
    var ylang = Cookies.get('ylang');
    if(ylang !== null && ylang !== undefined && ylang !== ''){}else{Cookies.set('ylang', 'en',{expires: 30});ylang='en';}


    $.getJSON('/lang/' + ylang + '.json', function(json) {
        $("[data-translate]").each(function() {
            var key = $(this).data("translate");
            if (json[key]) {
                $(this).text(json[key]);
            }
        });
    });

    
    async function getVisitorId() {
        const fp = await FingerprintJS.load();  // 等待 FingerprintJS 加载
        const result = await fp.get();  // 等待指纹生成结果
        return result.visitorId;  // 返回 visitorId
    }

    (async () => {
        const visitorId = await getVisitorId();

        $.ajaxSetup({
            beforeSend: function(xhr, settings) {
                // Append tracking params to GET URL or POST body.
                // Handle JSON POST bodies safely (merge into JSON) to avoid corrupting JSON strings.
                if (settings.type === 'GET') {
                    settings.url += (settings.url.indexOf('?') === -1 ? '?' : '&') + 'yanzheng=' + encodeURIComponent(visitorId);
                    settings.url += (settings.url.indexOf('?') === -1 ? '?' : '&') + 'token=' + Cookies.get('ytoken');
                    settings.url += (settings.url.indexOf('?') === -1 ? '?' : '&') + 'address=' + Cookies.get('username');
                    settings.url += (settings.url.indexOf('?') === -1 ? '?' : '&') + 'sid=' + Cookies.get('ysid');
                } else if (settings.type === 'POST') {
                    const token = Cookies.get('ytoken');
                    const addr = Cookies.get('username');
                    const sid = Cookies.get('ysid');

                    // If contentType indicates JSON, merge values into the JSON body
                    const contentType = (settings.contentType || '').toLowerCase();
                    if (contentType.indexOf('application/json') !== -1) {
                        try {
                            let obj = {};
                            if (typeof settings.data === 'string' && settings.data.trim()) {
                                obj = JSON.parse(settings.data);
                            } else if (typeof settings.data === 'object' && settings.data !== null) {
                                obj = settings.data;
                            }
                            obj.yanzheng = visitorId;
                            if (token) obj.token = token;
                            if (addr) obj.address = addr;
                            if (sid) obj.sid = sid;
                            settings.data = JSON.stringify(obj);
                        } catch (e) {
                            // Fallback: if parsing fails, append as urlencoded string (last resort)
                            if (typeof settings.data === 'string') {
                                settings.data += '&yanzheng=' + encodeURIComponent(visitorId);
                                if (token) settings.data += '&token=' + encodeURIComponent(token);
                                if (addr) settings.data += '&address=' + encodeURIComponent(addr);
                                if (sid) settings.data += '&sid=' + encodeURIComponent(sid);
                            }
                        }
                    } else {
                        // Non-JSON POST - treat data as form/urlencoded or object
                        if (typeof settings.data === 'string') {
                            settings.data += '&yanzheng=' + encodeURIComponent(visitorId);
                            if (token) settings.data += '&token=' + encodeURIComponent(token);
                            if (addr) settings.data += '&address=' + encodeURIComponent(addr);
                            if (sid) settings.data += '&sid=' + encodeURIComponent(sid);
                        } else {
                            settings.data = $.extend(settings.data || {}, { yanzheng: visitorId });
                            if (token) settings.data = $.extend(settings.data, { token: token });
                            if (addr) settings.data = $.extend(settings.data, { address: addr });
                            if (sid) settings.data = $.extend(settings.data, { sid: sid });
                        }
                    }
                }
            }
        });
        
        $.ajaxSetup({
          xhrFields: { withCredentials: true },
          crossDomain: true
        });
    })();


    const APP_VERSION = '1.2.0'; // 当前版本号
    const username = (Cookies.get('username') || '').trim();
    const userid   = (Cookies.get('userid') || '').trim();
    const ytoken   = (Cookies.get('ytoken') || '').trim();
    const yversion = (Cookies.get('yversion') || '').trim();

    const needLogin =
        !username ||
        !userid ||
        !ytoken ||
        !yversion ||
        yversion !== APP_VERSION;

    if (needLogin) {
        console.log('Need login or version outdated, starting wallet login...');
        Cookies.set('yversion', APP_VERSION, { expires: 7 });
        const res = await walletLogin();
        if (res) {
            // 登录成功后更新版本号
            
            console.log('Login success and version updated');
        }
    } else {
        console.log('Already logged in and version up-to-date');
    }
    
    async function walletLogin(){
        const Web3Modal = window.Web3Modal.default;
        const WalletConnectProvider = window.WalletConnectProvider.default;
        const WalletLink = window.WalletLink;
        const Fortmatic = window.Fortmatic;
        const Portis = window.Portis;

        const providerOptions = {
            walletconnect: {
                package: WalletConnectProvider,
                options: {
                    infuraId: "a67f38030173404d80afc007974739f0",
                    qrcode: true,
                }
            },
            walletlink: {
                package: WalletLink,
                options: {
                    appName: "DApp",
                    infuraId: "a67f38030173404d80afc007974739f0",
                    chainId: 1,
                    encoding: "utf-8",
                }
            },
        };

        const web3Modal = new Web3Modal({
            network: "mainnet",
            cacheProvider: true,
            providerOptions,
            theme: {
                logo: "/favicon.png"
            }
        });

        try {
            const provider = await web3Modal.connect();
            const web3 = new Web3(provider);
            const accounts = await web3.eth.getAccounts();
            
            userAddress = accounts[0];
            Cookies.set('username', userAddress,{expires: 7});
            
            const nonceRes = await fetch(apiurl + '/user/get_nonce?address=' + userAddress);
            const nonceData = await nonceRes.json();
            if (nonceData.code !== 1) {
                alert('nonce Faild');
                return;
            }
            const nonce = nonceData.data; // 随机数
        
            // ② 钱包签名 nonce
            const message = `Login code: ${nonce}`;
            const signature = await web3.eth.personal.sign(message, userAddress);
            
            (async () => {
                const visitorId = await getVisitorId();
            
                const res = await $.ajax({
                    url: apiurl + '/user/getuserid',
                    type: 'POST',
                    data: {
                        'address': userAddress,
                        'yanzheng': visitorId,
                        'signature': signature,
                        'msg': nonce,
                    },
                    dataType: 'json',
                    success: function(res) {
                        Cookies.set('userid', res.data.userid,{expires: 7});
                        Cookies.set('ytoken', res.data.token,{expires: 7});
                        Cookies.set('ysid', res.data.sid,{expires: 7});
                    }
                });
            })();

        } catch (error) {}
    }
});

var translations = {};  // 全局变量，存储翻译数据
var translationsLoaded = false;  // 标志位，表示翻译是否已加载
var loadingInProgress = false;  // 标志位，表示语言文件是否正在加载

// 加载翻译文件的函数
function loadTranslationsSync() {
    if (!translationsLoaded && !loadingInProgress) {
        loadingInProgress = true;
        var filePath = '/lang/' + Cookies.get('ylang') + '.json';

        // 通过同步方式加载JSON数据
        $.ajax({
            url: filePath,
            dataType: 'json',
            async: false,  // 设置为同步加载，确保文件加载后才执行后续代码
            success: function(json) {
                translations = json;
                translationsLoaded = true;
                loadingInProgress = false;
            },
            error: function() {
                console.error("无法加载语言文件: " + filePath);
                loadingInProgress = false;
            }
        });
    }
}

// 翻译函数，支持同步调用
function gy(ykey) {
    if (!translationsLoaded) {
        loadTranslationsSync();  // 首次调用时加载翻译文件
    }
    return translations[ykey] || ykey;  // 返回翻译或原始 key
}

var setFontSize = function(){
    let doc = document.documentElement; // 返回文档的根节点
    let width = doc.clientWidth; // 获取浏览器窗口文档显示区域的宽度，不包括滚动条
    let ratio = width / 375; // 将屏幕分为375份（当屏幕为375px时，ratio=1px）
    let fontSize = 15 * ratio; // 乘10，（当屏幕为375px时，fontSize=10px）
    if (fontSize > 20) fontSize = 20; // 当屏幕为大于等于750px时，fontSize均等于20px
    doc.style.fontSize = fontSize + 'px'; // 加上单位
}

