/******************************************
 * 多电表版-网上国网🌏 
 *****************************************
 【项目概述】
 这是一个用于获取国家电网电力数据的脚本，主要功能：
 1. 登录网上国网APP，获取用户绑定的电表信息
 2. 查询电费余额、日用电量、月用电量等数据
 3. 通过MQTT将数据推送到Home Assistant
 4. 支持独立运行和青龙面板两种模式
 5. 支持Token缓存，避免频繁登录
 6. 支持历史数据本地存储
 
 【运行模式】
 - 独立运行：使用 config.env 配置文件，通过 npm start 运行
 - 青龙面板：使用青龙环境变量，通过定时任务运行
 
 【数据流向】
 网上国网API → 脚本处理 → MQTT推送 → Home Assistant → 前端展示
 
 *****************************************
 环境变量设置（独立运行时使用 config.env 文件）:
 WSGW_USERNAME="" #网上国网账号
 WSGW_PASSWORD="" #网上国网密码
 WSGW_RECENT_ELC_FEE="true" #是否获取最近电费
 MQTT_ENABLED="true" #是否启用MQTT推送
 WSGW_mqtt_host="" #mqtt服务器地址
 WSGW_mqtt_port="" #mqtt服务器端口
 WSGW_mqtt_username="" #mqtt服务器用户名
 WSGW_mqtt_password="" #mqtt服务器密码
 DATA_STORE_DIR="" #数据存储目录
 SAVE_HISTORY_DATA="true" #是否保存历史数据
 HISTORY_RETENTION_DAYS=365 #历史数据保留天数
 TOKEN_CACHE_HOURS=24 #Token缓存有效期（小时）
 QUERY_DAYS=7 #日用电量查询天数
 QUERY_START_DATE="" #自定义开始日期（YYYY-MM-DD）
 QUERY_END_DATE="" #自定义结束日期（YYYY-MM-DD）
 QUERY_CONS_NO="" #指定查询的用电户号（多个用逗号分隔）
 *****************************************
 mqtt订阅主题：nodejs/state-grid/{用电户号}
 *****************************************
 脚本声明:
 1. 本脚本仅用于学习研究，禁止用于商业用途
 2. 本脚本不保证准确性、可靠性、完整性和及时性
 3. 任何个人或组织均可无需经过通知而自由使用
 4. 作者对任何脚本问题概不负责，包括由此产生的任何损失
 5. 如果任何单位或个人认为该脚本可能涉嫌侵犯其权利，应及时通知并提供身份证明、所有权证明，我将在收到认证文件确认后删除
 6. 请勿将本脚本用于商业用途，由此引起的问题与作者无关
 7. 本脚本及其更新版权归作者所有
 *****************************************
 * 原作者 Yuheng0101 https://github.com/Yuheng0101/X
 * 原作者 x2rr https://github.com/x2rr/state-grid
 ******************************************/

/******************************************
 * 第一部分：基础模块导入和环境检测
 ******************************************/

const fs = require('fs');
const path = require('path');

/**
 * 检测是否在青龙面板环境中运行
 * 青龙面板会设置 QL_DIR 或 QL_BRANCH 环境变量，或者存在 /ql 目录
 */
const isQinglong = process.env.QL_DIR || process.env.QL_BRANCH || fs.existsSync('/ql');

/**
 * 环境变量加载逻辑
 * - 青龙面板：直接使用青龙设置的环境变量
 * - 独立运行：从 config.env 文件加载环境变量
 */
if (!isQinglong) {
  try {
    const dotenv = require('dotenv');
    const envPath = path.join(__dirname, 'config.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      console.log('✅ 已加载 config.env 配置文件');
    } else {
      const examplePath = path.join(__dirname, 'config.env.example');
      if (fs.existsSync(examplePath)) {
        console.log('⚠️ 未找到 config.env，请复制 config.env.example 并配置');
      }
    }
  } catch (e) {
    console.log('⚠️ dotenv 模块未安装，使用环境变量');
  }
}

/******************************************
 * 第二部分：运行环境检测工具函数
 * 
 * 这部分代码用于检测脚本运行在哪种环境中
 * 支持多种代理工具：Surge、Loon、Stash、Quantumult X、Shadowrocket
 * 本项目主要使用 Node.js 环境
 ******************************************/

/**
 * 获取当前运行环境类型
 * @returns {string} 环境名称：Surge/Loon/Stash/Node.js/Quantumult X/Shadowrocket
 */
const getEnv = () =>
  'undefined' != typeof $environment && $environment['surge-version']
    ? 'Surge'
    : 'undefined' != typeof $environment && $environment['stash-version']
      ? 'Stash'
      : eval('typeof process !== "undefined"')
        ? 'Node.js'
        : 'undefined' != typeof $task
          ? 'Quantumult X'
          : 'undefined' != typeof $loon
            ? 'Loon'
            : 'undefined' != typeof $rocket
              ? 'Shadowrocket'
              : void 0,
  isSurge = () => 'Surge' === getEnv(),
  isLoon = () => 'Loon' === getEnv(),
  isStash = () => 'Stash' === getEnv(),
  isNode = () => 'Node.js' === getEnv();

/******************************************
 * 第三部分：日志工具类
 * 
 * 提供分级日志输出功能，支持 trace/debug/info/warn/error 五个级别
 ******************************************/

class Logger {
  constructor(e = '日志输出', o = 'info') {
    (this.prefix = e),
      (this.levels = ['trace', 'debug', 'info', 'warn', 'error']),
      this.setLevel(o);
  }
  setLevel(e) {
    this.currentLevelIndex = this.levels.indexOf(e);
  }
  log(e, ...o) {
    this.levels.indexOf(e) >= this.currentLevelIndex &&
      console.log(
        `${this.prefix ? `[${this.prefix}] ` : ''}[${e.toUpperCase()}]\n` +
        [...o].join('\n')
      );
  }
  trace(...e) {
    this.log('trace', ...e);
  }
  debug(...e) {
    this.log('debug', ...e);
  }
  info(...e) {
    this.log('info', ...e);
  }
  warn(...e) {
    this.log('warn', ...e);
  }
  error(...e) {
    this.log('error', ...e);
  }
}

/******************************************
 * 第四部分：HTTP请求封装
 * 
 * 统一的HTTP请求方法，适配多种运行环境
 * 在Node.js环境中使用 got 库发送请求
 ******************************************/

const request$1 = async (request = {} || '', option = {}) => {
  switch (request.constructor) {
    case Object:
      request = { ...request, ...option };
      break;
    case String:
      request = { url: request, ...option };
  }
  request.method ||
    ((request.method = 'GET'),
      (request.body ?? request.bodyBytes) && (request.method = 'POST')),
    delete request.headers?.['Content-Length'],
    delete request.headers?.['content-length'];
  const method = request.method.toLocaleLowerCase();
  switch (getEnv()) {
    case 'Loon':
    case 'Surge':
    case 'Stash':
    case 'Shadowrocket':
    default:
      return (
        delete request.id,
        request.policy &&
        (isLoon() && (request.node = request.policy),
          isStash() &&
          (request.headers || (request.headers = {}),
            (request.headers['X-Stash-Selected-Proxy'] = encodeURI(
              request.policy
            )))),
        ArrayBuffer.isView(request.body) && (request['binary-mode'] = !0),
        request?.timeout &&
        isSurge() &&
        (request.timeout = Number(request.timeout) / 1e3),
        await new Promise((e, o) => {
          $httpClient[method](request, (r, s, n) => {
            r
              ? o(r)
              : ((s.ok = /^2\d\d$/.test(s.status)),
                (s.statusCode = s.status),
                n &&
                ((s.body = n),
                  1 == request['binary-mode'] && (s.bodyBytes = n)),
                e(s));
          });
        })
      );
    case 'Quantumult X':
      switch (
      (delete request.scheme,
        delete request.sessionIndex,
        delete request.charset,
        request.policy &&
        (request.opts || (request.opts = {}),
          (request.opts.policy = request.policy)),
        (
          request?.headers?.['Content-Type'] ??
          request?.headers?.['content-type']
        )?.split(';')?.[0])
      ) {
        default:
          delete request.bodyBytes;
          break;
        case 'application/protobuf':
        case 'application/x-protobuf':
        case 'application/vnd.google.protobuf':
        case 'application/grpc':
        case 'application/grpc+proto':
        case 'application/octet-stream':
          delete request.body,
            ArrayBuffer.isView(request.bodyBytes) &&
            (request.bodyBytes = request.bodyBytes.buffer.slice(
              request.bodyBytes.byteOffset,
              request.bodyBytes.byteLength + request.bodyBytes.byteOffset
            ));
        case void 0:
      }
      return await Promise.race([
        $task.fetch(request).then(
          e => (
            (e.ok = /^2\d\d$/.test(e.statusCode)), (e.status = e.statusCode), e
          ),
          e => Promise.reject(e.error)
        ),
        new Promise((e, o) =>
          setTimeout(o, request?.timeout ?? 5e3, 'timeout')
        ),
      ]);
    case 'Node.js':
      const got = eval('require("got")');
      let iconv = eval('require("iconv-lite")');
      const { url: url, ...option } = request;
      return await got[method](url, option).then(
        e => (
          (e.statusCode = e.status),
          (e.body = iconv.decode(e.rawBody, request?.encoding || 'utf-8')),
          (e.bodyBytes = e.rawBody),
          e
        ),
        e => {
          if (e.response && 500 === e.response.statusCode)
            return Promise.reject(e.response.body);
          Promise.reject(e.message);
        }
      );
  }
};

/******************************************
 * 第五部分：本地存储类
 * 
 * 用于持久化存储数据，如Token、用户信息等
 * 在Node.js环境中使用 node-localstorage 模拟浏览器 localStorage
 * 数据存储在 data/ONZ3V/ 目录下
 ******************************************/

class Store {
  constructor(NAMESPACE) {
    if (
      ((this.env = getEnv()),
        (this.Store = './store'),
        NAMESPACE && (this.Store = `./store/${NAMESPACE}`),
        'Node.js' === this.env)
    ) {
      const dataDir = process.env.DATA_STORE_DIR || './data';
      const storePath = NAMESPACE ? path.join(dataDir, NAMESPACE) : dataDir;
      if (!fs.existsSync(storePath)) {
        fs.mkdirSync(storePath, { recursive: true });
      }
      const { LocalStorage: LocalStorage } = eval(
        'require("node-localstorage")'
      );
      this.localStorage = new LocalStorage(storePath);
    }
  }
  get(e) {
    switch (this.env) {
      case 'Surge':
      case 'Loon':
      case 'Stash':
      case 'Shadowrocket':
        return $persistentStore.read(e);
      case 'Quantumult X':
        return $prefs.valueForKey(e);
      case 'Node.js':
        return this.localStorage.getItem(e);
      default:
        return null;
    }
  }
  set(e, o) {
    switch (this.env) {
      case 'Surge':
      case 'Loon':
      case 'Stash':
      case 'Shadowrocket':
        return $persistentStore.write(o, e);
      case 'Quantumult X':
        return $prefs.setValueForKey(o, e);
      case 'Node.js':
        return this.localStorage.setItem(e, o), !0;
      default:
        return null;
    }
  }
  clear(e) {
    switch (this.env) {
      case 'Surge':
      case 'Loon':
      case 'Stash':
      case 'Shadowrocket':
        return $persistentStore.write(null, e);
      case 'Quantumult X':
        return $prefs.removeValueForKey(e);
      case 'Node.js':
        return this.localStorage.removeItem(e), !0;
      default:
        return null;
    }
  }
}

/******************************************
 * 第六部分：历史数据管理类
 * 
 * 用于管理用电历史数据的持久化存储
 * - 将每日用电数据保存到本地JSON文件
 * - 支持数据去重和过期数据清理
 * - 解决了国网API只返回7天数据的限制
 ******************************************/

class HistoryDataManager {
  constructor() {
    this.dataDir = process.env.DATA_STORE_DIR || path.join(__dirname, 'data');
    this.historyFile = path.join(this.dataDir, 'history_data.json');
    this.retentionDays = parseInt(process.env.HISTORY_RETENTION_DAYS) || 365;
    this.saveEnabled = process.env.SAVE_HISTORY_DATA !== 'false';

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * 从文件加载历史数据
   * @returns {Object} 包含 dayList 和 monthList 的历史数据对象
   */
  load() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const content = fs.readFileSync(this.historyFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch (e) {
      console.log('⚠️ 加载历史数据失败:', e.message);
    }
    return { dayList: {}, monthList: {} };
  }

  /**
   * 保存用电数据到历史记录
   * @param {Object} data - 包含 dayList 和 monthList 的数据对象
   * @param {string} consNo - 用电户号，作为数据索引
   * 
   * 功能说明：
   * 1. 合并新旧数据，避免重复
   * 2. 按日期排序
   * 3. 清理超过保留天数的数据
   */
  save(data, consNo) {
    if (!this.saveEnabled) return;

    try {
      const history = this.load();

      if (!history.dayList[consNo]) {
        history.dayList[consNo] = [];
      }

      const existingDays = new Set(history.dayList[consNo].map(d => d.day));
      for (const dayData of data.dayList || []) {
        if (!existingDays.has(dayData.day)) {
          history.dayList[consNo].push(dayData);
          existingDays.add(dayData.day);
        }
      }

      history.dayList[consNo].sort((a, b) => a.day.localeCompare(b.day));

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      const cutoffStr = cutoffDate.toISOString().split('T')[0];
      history.dayList[consNo] = history.dayList[consNo].filter(d => d.day >= cutoffStr);

      history.monthList[consNo] = data.monthList || [];
      history.lastUpdate = new Date().toISOString();
      history.lastUpdateConsNo = consNo;

      fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2));
      console.log(`✅ 历史数据已保存，共 ${history.dayList[consNo].length} 条日用电记录`);
    } catch (e) {
      console.log('⚠️ 保存历史数据失败:', e.message);
    }
  }

  /**
   * 获取指定户号的历史数据
   * @param {string} consNo - 用电户号
   * @returns {Object} 该户号的历史数据
   */
  getHistory(consNo) {
    const history = this.load();
    return {
      dayList: history.dayList[consNo] || [],
      monthList: history.monthList[consNo] || []
    };
  }
}

/******************************************
 * 第七部分：工具函数
 ******************************************/

/**
 * 通知函数（简化版，仅输出到控制台）
 */
const notify = (e = '', o = '', r = '', s = {}) => {
  let t = ['', '==============📣系统通知📣=============='];
  t.push(e), o && t.push(o), r && t.push(r), console.log(t.join('\n'));
},
  /**
   * 脚本结束函数
   * 根据运行环境执行不同的退出逻辑
   */
  done = (e = {}) => {
    switch (getEnv()) {
      case 'Surge':
      case 'Loon':
      case 'Stash':
      case 'Shadowrocket':
      case 'Quantumult X':
      default:
        $done(e);
        break;
      case 'Node.js':
        process.exit(0);
    }
  },
  /**
   * 中转服务器地址
   * 用于加密/解密网上国网API请求
   * 为什么需要中转服务器？
   * - 网上国网API使用了复杂的加密算法
   * - 中转服务器负责处理加密/解密，简化本地脚本逻辑
   */
  SERVER_HOST = 'https://api.120399.xyz',
  /**
   * 网上国网官方API地址
   */
  BASE_URL = 'https://www.95598.cn',
  /**
   * 核心请求函数
   * 
   * 工作流程：
   * 1. 将请求数据发送到中转服务器进行加密
   * 2. 使用加密后的数据请求网上国网API
   * 3. 将响应数据发送到中转服务器进行解密
   * 4. 返回解密后的数据
   * 
   * @param {Object} e - 请求配置对象
   * @returns {Promise} 解密后的API响应数据
   */
  request = async e => {
    try {
      const o = {
        url: `${SERVER_HOST}/wsgw/encrypt`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ yuheng: e }),
      },
        r = await Encrypt(o);
      switch (e.url) {
        case '/api/oauth2/oauth/authorize':
          Object.assign(r, { body: r.body.replace(/^\"|\"$/g, '') });
          break;
        case '/api/oauth2/outer/getWebToken':
          o.headers['content-type'] = 'text/plain;charset=UTF-8';
      }
      let { body: s } = await request$1(r);
      try {
        s = JSON.parse(s);
      } catch { }
      if (
        s.code &&
        (10010 == s.code ||
          (10002 === s.code && 'WEB渠道KeyCode已失效' == s.message) ||
          30010 === s.code ||
          '20103' === s.code ||
          (10002 === s.code && bizrt.token && 'Token 为空！' == s.message))
      )
        return Promise.reject(s.message);
      const n = { config: { ...e }, data: s };
      if ('/api/oauth2/outer/c02/f02' === e.url)
        Object.assign(n.config, { headers: { encryptKey: r.encryptKey } });
      const t = {
        url: `${SERVER_HOST}/wsgw/decrypt`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ yuheng: n }),
      };
      return await Decrypt(t);
    } catch (e) {
      return Promise.reject(e);
    }
  },
  /**
   * 加密函数
   * 调用中转服务器对请求进行加密
   */
  Encrypt = async e =>
    request$1(e).then(({ body: e }) => {
      try {
        e = JSON.parse(e);
      } catch { }
      return (
        (e.data.url = BASE_URL + e.data.url),
        (e.data.body = JSON.stringify(e.data.data)),
        delete e.data.data,
        e.data
      );
    }),
  /**
   * 解密函数
   * 调用中转服务器对响应进行解密
   */
  Decrypt = async e =>
    request$1(e).then(({ body: o }) => {
      let r = JSON.parse(o);
      const { code: s, message: n, data: t } = r.data;
      return '' + s == '1'
        ? t
        : e.url.indexOf('oauth2/oauth/authorize') > -1 &&
          t &&
          s &&
          '' != s &&
          (10015 === s ||
            10108 === s ||
            10009 === s ||
            10207 === s ||
            10005 === s ||
            10010 === s ||
            30010 === s ||
            (10002 === s && 'WEB渠道KeyCode已失效' == n) ||
            (10002 === s && bizrt.token && 'Token 为空！' == n))
          ? Promise.reject(`重新获取: ${n}`)
          : Promise.reject(n);
    }),
  /**
   * 验证码识别函数
   * 调用中转服务器识别滑块验证码
   */
  Recoginze = async e => {
    const o = {
      url: `${SERVER_HOST}/wsgw/get_x`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yuheng: e }),
    };
    return request$1(o).then(({ body: e }) => JSON.parse(e));
  },
  /**
   * 获取指定天数前的日期字符串
   * @param {number} e - 天数
   * @returns {string} 格式为 YYYY-MM-DD 的日期字符串
   */
  getBeforeDate = e => {
    const o = new Date();
    o.setDate(o.getDate() - e);
    return `${o.getFullYear()}-${String(o.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(o.getDate()).padStart(2, '0')}`;
  },
  /**
   * JSON解析函数（带容错）
   */
  jsonParse = e => {
    try {
      return JSON.parse(e);
    } catch {
      return e;
    }
  },
  /**
   * JSON字符串化函数（带容错）
   */
  jsonStr = (e, ...o) => {
    if ('string' == typeof e) return e;
    try {
      return JSON.stringify(e, ...o);
    } catch {
      return e;
    }
  },
  /**
   * 判断值是否为"真"
   * 支持 true、'true'、1、'1' 四种形式
   */
  isTrue = e => !0 === e || 'true' === e || 1 === e || '1' === e;

/******************************************
 * 第八部分：API接口定义
 * 
 * 网上国网APP的API接口路径
 ******************************************/

const $api = {
  getKeyCode: '/oauth2/outer/c02/f02',        // 获取加密密钥
  getAuth: '/oauth2/oauth/authorize',          // 获取授权码
  getWebToken: '/oauth2/outer/getWebToken',    // 获取访问令牌
  searchUser: '/osg-open-uc0001/member/c9/f02', // 查询用户绑定信息
  loginVerifyCodeNew: '/osg-web0004/open/c44/f05', // 获取验证码
  loginTestCodeNew: '/osg-web0004/open/c44/f06',   // 登录验证
  accapi: '/osg-open-bc0001/member/c05/f01',       // 查询电费
  busInfoApi: '/osg-web0004/member/c24/f01',       // 查询用电量
};

/******************************************
 * 第九部分：API请求配置
 * 
 * 网上国网API所需的固定参数配置
 * 这些参数模拟了官方APP的请求格式
 ******************************************/

const $configuration = {
  source: 'SGAPP',
  target: 'SGAPP',
  serviceCode: '0101183',
  uscInfo: {
    member: '0902',
    devciceIp: '',
    devciceId: '',
    tenant: 'state_grid',
  },
  userInform: { serviceCode: '0101143' },
  account: { channelCode: '0902', funcCode: 'WEBA10071300' },
  getday: {
    channelCode: '0902',
    clearCache: '11',
    funcCode: 'WEBALIPAY_01',
    promotCode: '1',
    promotType: '1',
    serviceCode: 'BCP_000026',
    source: 'app',
  },
  mouthOut: {
    channelCode: '0902',
    clearCache: '11',
    funcCode: 'WEBALIPAY_01',
    promotCode: '1',
    promotType: '1',
    serviceCode: 'BCP_000026',
    source: 'app',
  },
};

/******************************************
 * 第十部分：全局变量初始化
 ******************************************/

/**
 * 青龙通知模块（仅在青龙环境中加载）
 */
let Notify = '';
if (isNode() && isQinglong) {
  try {
    Notify = require('./sendNotify');
  } catch (e) {
    console.log('⚠️ sendNotify 模块未找到，跳过青龙通知');
  }
}

const SCRIPTNAME = '网上国网',
  NAMESPACE = 'ONZ3V',
  /**
   * 本地存储实例
   * 用于保存Token和用户信息
   */
  store = new Store(NAMESPACE),
  /**
   * 全局对象
   * 用于在函数间共享数据
   */
  Global = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

/**
 * 从本地存储加载用户凭证
 * 包含 token 和 userInfo 等登录信息
 */
Global.bizrt = jsonParse(store.get('95598_bizrt')) || {};

/**
 * 日志实例
 * 可通过 WSGW_LOG_DEBUG 环境变量开启调试模式
 */
const log = new Logger(SCRIPTNAME, isTrue(process.env.WSGW_LOG_DEBUG) ? 'debug' : 'info'),
  /**
   * 用户账号密码
   */
  USERNAME = process.env.WSGW_USERNAME || '',
  PASSWORD = process.env.WSGW_PASSWORD || '',
  /**
   * 是否显示最近电费详情
   */
  SHOW_RECENT = isTrue(process.env.WSGW_RECENT_ELC_FEE);

/**
 * 历史数据管理器实例
 */
const historyManager = new HistoryDataManager();

/******************************************
 * 第十一部分：核心业务函数
 * 
 * 以下是脚本的主要业务逻辑函数
 * 按照执行顺序排列
 ******************************************/

/**
 * 步骤1：获取加密密钥
 * 
 * 每次API请求都需要使用 keyCode 和 publicKey 进行加密
 * 这是网上国网API的安全机制
 */
async function getKeyCode() {
  console.log('⏳ 获取keyCode和publicKey...');
  try {
    const e = { url: `/api${$api.getKeyCode}`, method: 'post', headers: {} };
    Global.requestKey = await request(e);
    log.info('✅ 获取keyCode和publicKey成功');
    log.debug(`🔑 keyCode&publicKey: ${jsonStr(requestKey, null, 2)}`);
  } catch (e) {
    return Promise.reject(`获取keyCode和PublicKey失败: ${e}`);
  } finally {
    console.log('🔚 获取keyCode和publicKey结束');
  }
}

/**
 * 步骤2a：获取验证码
 * 
 * 网上国网登录需要滑块验证码
 * 1. 请求获取验证码图片和ticket
 * 2. 调用中转服务器识别验证码
 * 
 * @returns {Object} 包含 code（验证码识别结果）和 ticket
 */
async function getVerifyCode() {
  console.log('⏳ 获取验证码...');
  try {
    const e = {
      url: `/api${$api.loginVerifyCodeNew}`,
      method: 'post',
      data: { password: PASSWORD, account: USERNAME, canvasHeight: 200, canvasWidth: 310 },
      headers: { ...requestKey },
    };
    const o = await request(e);
    log.info('✅ 获取验证码凭证成功');
    const { data: r } = await Recoginze(o.canvasSrc);
    log.info('✅ 识别验证码成功');
    return { code: r, ticket: o.ticket };
  } catch (e) {
    return Promise.reject('获取验证码失败: ' + e);
  } finally {
    console.log('🔚 获取验证码结束');
  }
}

/**
 * 步骤2b：登录
 * 
 * 使用验证码完成登录
 * 登录成功后会返回 token 和 userInfo
 * 
 * @param {string} e - ticket（验证码凭证）
 * @param {string} o - code（验证码识别结果）
 */
async function login(e, o) {
  console.log('⏳ 登录中...');
  try {
    const r = {
      url: `/api${$api.loginTestCodeNew}`,
      method: 'post',
      headers: { ...requestKey },
      data: {
        loginKey: e,
        code: o,
        params: {
          uscInfo: { devciceIp: '', tenant: 'state_grid', member: '0902', devciceId: '' },
          quInfo: { optSys: 'android', pushId: '000000', addressProvince: '110100', password: PASSWORD, addressRegion: '110101', account: USERNAME, addressCity: '330100' },
        },
        Channels: 'web',
      },
    };
    const { bizrt: s } = await request(r);
    if (!(s?.userInfo?.length > 0)) return Promise.reject('登录失败: 请检查信息填写是否正确! ');
    /**
     * 登录成功后保存凭证到本地存储
     * - 95598_bizrt: 用户凭证（token、userInfo等）
     * - 95598_token_time: 凭证保存时间（用于判断是否过期）
     */
    store.set('95598_bizrt', jsonStr(s));
    store.set('95598_token_time', Date.now().toString());
    Global.bizrt = s;
    log.info('✅ 登录成功');
    log.debug(`🔑 用户凭证: ${s.token}`, `👤 用户信息: ${s.userInfo[0].nickname || s.userInfo[0].loginAccount}`);
  } catch (e) {
    /**
     * 如果验证码识别错误，自动重试登录
     */
    return /验证错误/.test(e) ? (log.error(`滑块验证出错, 重新登录: ${e}`), await doLogin()) : Promise.reject(`登陆失败: ${e}`);
  } finally {
    console.log('🔚 登录结束');
  }
}

/**
 * Token有效性检查
 * 
 * 检查缓存的Token是否仍然有效
 * 1. 检查Token是否存在
 * 2. 检查Token是否过期（根据TOKEN_CACHE_HOURS配置）
 * 3. 尝试使用Token获取授权码，验证其有效性
 * 
 * @returns {boolean} Token是否有效
 */
async function checkTokenValid() {
  if (!bizrt?.token || !bizrt?.userInfo) {
    console.log('ℹ️ 无缓存token，需要登录');
    return false;
  }

  const savedTime = store.get('95598_token_time');
  if (savedTime) {
    const tokenAge = Date.now() - parseInt(savedTime);
    const cacheHours = parseFloat(process.env.TOKEN_CACHE_HOURS) || 24;
    const maxAge = cacheHours * 60 * 60 * 1000;
    if (tokenAge > maxAge) {
      console.log(`ℹ️ Token已过期（超过${cacheHours}小时），需要重新登录`);
      store.clear('95598_bizrt');
      store.clear('95598_token_time');
      Global.bizrt = {};
      return false;
    }
  }

  console.log('⏳ 尝试使用缓存token...');
  try {
    /**
     * 尝试使用缓存的token获取授权码
     * 如果成功，说明token有效，同时获取了authorizecode
     */
    const e = { url: `/api${$api.getAuth}`, method: 'post', headers: { ...requestKey, token: bizrt.token } };
    const { redirect_url: o } = await request(e);
    Global.authorizecode = o.split('?code=')[1];
    console.log('✅ 缓存token有效');
    return true;
  } catch (e) {
    console.log('⚠️ 缓存token无效:', e);
    store.clear('95598_bizrt');
    store.clear('95598_token_time');
    Global.bizrt = {};
    return false;
  }
}

/**
 * 步骤3：获取授权码
 * 
 * 授权码用于后续获取访问令牌
 * 这是OAuth2授权流程的一部分
 */
async function getAuthcode() {
  console.log('⏳ 获取授权码...');
  try {
    const e = { url: `/api${$api.getAuth}`, method: 'post', headers: { ...requestKey, token: bizrt.token } };
    const { redirect_url: o } = await request(e);
    Global.authorizecode = o.split('?code=')[1];
    log.info('✅ 获取授权码成功');
  } catch (e) {
    return Promise.reject(`获取授权码失败: ${e}`);
  } finally {
    console.log('🔚 获取授权码结束');
  }
}

/**
 * 步骤4：获取访问令牌
 * 
 * 访问令牌（accessToken）用于后续所有API请求的身份验证
 */
async function getAccessToken() {
  console.log('⏳ 获取凭证...');
  try {
    const e = { url: `/api${$api.getWebToken}`, method: 'post', headers: { ...requestKey, token: bizrt.token, authorizecode: authorizecode } };
    Global.accessToken = await request(e).then(e => e.access_token);
    log.info('✅ 获取凭证成功');
  } catch (e) {
    return Promise.reject(`获取凭证失败: ${e}`);
  } finally {
    console.log('🔚 获取凭证结束');
  }
}

/**
 * 步骤5：查询用户绑定信息
 * 
 * 获取用户绑定的电表列表
 * 一个账号可能绑定多个电表（如家庭、公司等）
 */
async function getBindInfo() {
  console.log('⏳ 查询绑定信息...');
  try {
    const e = {
      url: `/api${$api.searchUser}`,
      method: 'post',
      headers: { ...requestKey, token: bizrt.token, acctoken: accessToken },
      data: {
        serviceCode: $configuration.userInform.serviceCode,
        source: $configuration.source,
        target: $configuration.target,
        uscInfo: { member: $configuration.uscInfo.member, devciceIp: $configuration.uscInfo.devciceIp, devciceId: $configuration.uscInfo.devciceId, tenant: $configuration.uscInfo.tenant },
        quInfo: { userId: bizrt.userInfo[0].userId },
        token: bizrt.token,
        Channels: 'web',
      },
    };
    Global.bindInfo = await request(e).then(e => e.bizrt);
    log.info('✅ 获取绑定信息成功');
    log.debug(`🔑 用户绑定信息: ${jsonStr(bindInfo, null, 2)}`);
  } catch (e) {
    return Promise.reject(`获取绑定信息失败: ${e}`);
  } finally {
    console.log('🔚 查询绑定信息结束');
  }
}

/**
 * 步骤6：查询电费
 * 
 * 获取电费余额、本期用电量等信息
 * 
 * @param {number} e - 电表索引（用户可能绑定多个电表）
 */
async function getElcFee(e) {
  console.log('⏳ 查询电费...');
  try {
    const o = bindInfo.powerUserList[e],
      [r] = bizrt.userInfo,
      s = {
        url: `/api${$api.accapi}`,
        method: 'post',
        headers: { ...requestKey, token: bizrt.token, acctoken: accessToken },
        data: {
          data: {
            srvCode: '',
            serialNo: '',
            channelCode: $configuration.account.channelCode,
            funcCode: $configuration.account.funcCode,
            acctId: r.userId,
            userName: r.loginAccount ? r.loginAccount : r.nickname,
            promotType: '1',
            promotCode: '1',
            userAccountId: r.userId,
            list: [{ consNoSrc: o.consNo_dst, proCode: o.proNo, sceneType: o.constType, consNo: o.consNo, orgNo: o.orgNo }],
          },
          serviceCode: '0101143',
          source: $configuration.source,
          target: o.proNo || o.provinceId,
        },
      };
    Global.eleBill = await request(s).then(e => e.list[0]);
    log.info('✅ 查询电费成功');
    log.debug(`🔑 电费信息: ${jsonStr(Global.eleBill, null, 2)}`);
  } catch (e) {
    return Promise.reject(`查询电费失败: ${e}`);
  } finally {
    console.log('🔚 查询电费结束');
  }
}

/**
 * 步骤7：获取日用电量
 * 
 * 获取指定时间范围的每日用电量数据
 * 支持三种模式：
 * 1. 默认模式：查询最近7天
 * 2. 指定天数：通过 QUERY_DAYS 环境变量配置
 * 3. 指定日期范围：通过 QUERY_START_DATE 和 QUERY_END_DATE 配置
 * 
 * 注意：国网API对查询天数有限制，建议不超过30天
 * 
 * @param {number} e - 电表索引
 */
async function getDayElecQuantity(e) {
  console.log('⏳ 获取日用电量...');
  try {
    const o = bindInfo.powerUserList[e],
      [r] = bizrt.userInfo;

    /**
     * 计算查询时间范围
     * 优先级：自定义日期 > 指定天数 > 默认7天
     */
    let startTime, endTime;
    const customStartDate = process.env.QUERY_START_DATE;
    const customEndDate = process.env.QUERY_END_DATE;
    const queryDays = parseInt(process.env.QUERY_DAYS) || 7;

    if (customStartDate) {
      startTime = customStartDate;
      endTime = customEndDate || getBeforeDate(1);
      console.log(`📅 自定义查询范围: ${startTime} ~ ${endTime}`);
    } else {
      startTime = getBeforeDate(queryDays + 1);
      endTime = getBeforeDate(1);
      console.log(`📅 查询最近 ${queryDays} 天: ${startTime} ~ ${endTime}`);
    }

    const t = {
      url: `/api${$api.busInfoApi}`,
      method: 'post',
      headers: { ...requestKey, token: bizrt.token, acctoken: accessToken },
      data: {
        params1: {
          serviceCode: $configuration.serviceCode,
          source: $configuration.source,
          target: $configuration.target,
          uscInfo: { member: $configuration.uscInfo.member, devciceIp: $configuration.uscInfo.devciceIp, devciceId: $configuration.uscInfo.devciceId, tenant: $configuration.uscInfo.tenant },
          quInfo: { userId: r.userId },
          token: bizrt.token,
        },
        params3: {
          data: {
            acctId: r.userId,
            consNo: o.consNo_dst,
            consType: '02' == o.constType ? '02' : '01',
            endTime: endTime,
            orgNo: o.orgNo,
            queryYear: new Date().getFullYear().toString(),
            proCode: o.proNo || o.provinceId,
            serialNo: '',
            srvCode: '',
            startTime: startTime,
            userName: r.nickname ? r.nickname : r.loginAccount,
            funcCode: $configuration.getday.funcCode,
            channelCode: $configuration.getday.channelCode,
            clearCache: $configuration.getday.clearCache,
            promotCode: $configuration.getday.promotCode,
            promotType: $configuration.getday.promotType,
          },
          serviceCode: $configuration.getday.serviceCode,
          source: $configuration.getday.source,
          target: o.proNo || o.provinceId,
        },
        params4: '010103',
      },
    };
    const c = await request(t);
    log.info('✅ 获取日用电量成功');
    log.debug(jsonStr(c, null, 2));
    Global.dayElecQuantity = c;
  } catch (e) {
    return Promise.reject('获取日用电量失败: ' + e);
  } finally {
    console.log('🔚 获取日用电量结束');
  }
}

/**
 * 步骤8：获取月用电量
 * 
 * 获取最近12个月的月用电量数据
 * 如果当年数据不足12个月，会自动获取去年的数据补充
 * 
 * @param {number} e - 电表索引
 */
async function getMonthElecQuantity(e) {
  console.log('⏳ 获取月用电量...');
  const o = bindInfo.powerUserList[e],
    [r] = bizrt.userInfo;
  try {
    let queryYear = new Date().getFullYear().toString();
    let e = {
      url: `/api${$api.busInfoApi}`,
      method: 'post',
      headers: { ...requestKey, token: bizrt.token, acctoken: accessToken },
      data: {
        params1: {
          serviceCode: $configuration.serviceCode,
          source: $configuration.source,
          target: $configuration.target,
          uscInfo: { member: $configuration.uscInfo.member, devciceIp: $configuration.uscInfo.devciceIp, devciceId: $configuration.uscInfo.devciceId, tenant: $configuration.uscInfo.tenant },
          quInfo: { userId: r.userId },
          token: bizrt.token,
        },
        params3: {
          data: {
            acctId: r.userId,
            consNo: o.consNo_dst,
            consType: '02' == o.constType ? '02' : '01',
            orgNo: o.orgNo,
            proCode: o.proNo || o.provinceId,
            provinceCode: o.proNo || o.provinceId,
            queryYear: queryYear,
            serialNo: '',
            srvCode: '',
            userName: r.nickname ? r.nickname : r.loginAccount,
            funcCode: $configuration.mouthOut.funcCode,
            channelCode: $configuration.mouthOut.channelCode,
            clearCache: $configuration.mouthOut.clearCache,
            promotCode: $configuration.mouthOut.promotCode,
            promotType: $configuration.mouthOut.promotType,
          },
          serviceCode: $configuration.mouthOut.serviceCode,
          source: $configuration.mouthOut.source,
          target: o.proNo || o.provinceId,
        },
        params4: '010102',
      },
    };
    const s = await request(e);
    /**
     * 如果当年数据不足12个月，获取去年的数据补充
     */
    if (!s.mothEleList || s.mothEleList.length < 12) {
      queryYear = (new Date().getFullYear() - 1).toString();
      e.data.params3.data.queryYear = queryYear;
      const prevYearData = await request(e);
      let arr = s.mothEleList || [];
      s.mothEleList = prevYearData.mothEleList.concat(arr);
    }
    log.info('✅ 获取月用电量成功');
    log.debug(jsonStr(s, null, 2));
    Global.monthElecQuantity = s;
  } catch (e) {
    return Promise.reject(`获取月用电量失败: ${e}`);
  } finally {
    console.log('🔚 获取月用电量结束');
  }
}

/**
 * 登录流程封装
 * 依次执行：获取验证码 → 登录
 */
async function doLogin() {
  const { code: e, ticket: o } = await getVerifyCode();
  await login(o, e);
}

/**
 * 日期格式化函数
 * 将 YYYYMMDD 格式转换为 YYYY-MM-DD 格式
 * 
 * @param {string} dateStr - 原始日期字符串
 * @returns {string} 格式化后的日期字符串
 */
function formatDate(dateStr) {
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  return year + '-' + month + (day ? '-' + day : '');
}

/**
 * 步骤9：发送数据到MQTT
 * 
 * 将获取到的电费数据通过MQTT推送到Home Assistant
 * 
 * 数据格式：
 * {
 *   consNo: "户号",
 *   sumMoney: "账户余额",
 *   totalPq: "本期用电量",
 *   date: "截至日期",
 *   dayList: [...],    // 日用电量列表
 *   monthList: [...],  // 月用电量列表
 *   totalEleNum: "年度用电量",
 *   totalEleCost: "年度电费"
 * }
 * 
 * @param {string} e - 脚本名称
 * @param {Object} eleBill - 电费信息
 * @param {Array} dayList - 日用电量列表
 * @param {Object} monthElecQuantity - 月用电量数据
 */
async function sendMsg(e, eleBill, dayList, monthElecQuantity) {
  const mqttEnabled = isTrue(process.env.MQTT_ENABLED);
  const host = process.env.WSGW_mqtt_host || '',
    port = process.env.WSGW_mqtt_port || '',
    mqtt_username = process.env.WSGW_mqtt_username || '',
    mqtt_password = process.env.WSGW_mqtt_password || '';

  /**
   * 先保存历史数据到本地
   * 即使MQTT禁用，也会保存历史数据
   */
  historyManager.save({ dayList, monthList: monthElecQuantity.mothEleList || [] }, eleBill.consNo);

  if (!mqttEnabled) {
    console.log('ℹ️ MQTT已禁用，跳过发送');
    return;
  }

  if (!host) {
    console.log('⚠️ MQTT地址未配置，跳过发送');
    return;
  }

  const mqtt = require('mqtt');
  const clientId = 'mqtt_state_grid_' + Date.now();
  const connectUrl = `mqtt://${host}:${port}`;

  /**
   * 连接MQTT服务器
   */
  const client = mqtt.connect(connectUrl, {
    clientId,
    clean: true,
    connectTimeout: 2000,
    username: mqtt_username,
    password: mqtt_password,
    reconnectPeriod: 1000,
  });

  /**
   * MQTT主题：nodejs/state-grid/{用电户号}
   * Home Assistant 订阅此主题获取数据
   */
  const topic = 'nodejs/state-grid/' + eleBill.consNo;
  let data = { ...eleBill };

  /**
   * 格式化日用电数据
   * - 过滤无效数据
   * - 转换日期格式
   */
  dayList = dayList.filter(val => val.dayElePq != '-').map(val => {
    val.day = formatDate(val.day);
    return val;
  });

  /**
   * 格式化月用电数据
   */
  let monthList = [];
  if (monthElecQuantity.mothEleList) {
    monthList = monthElecQuantity.mothEleList.map(val => {
      val.month = formatDate(val.month);
      return val;
    });
  }

  /**
   * 组装最终数据
   */
  data.dayList = dayList;
  data.monthList = monthList;
  data.totalEleNum = monthElecQuantity?.dataInfo?.totalEleNum || 0;
  data.totalEleCost = monthElecQuantity?.dataInfo?.totalEleCost || 0;

  /**
   * 发布消息到MQTT
   * 使用 retain: true 确保新订阅者能立即获取最新数据
   */
  client.on('connect', () => {
    console.log('mqtt:Connected');
    client.publish(topic, JSON.stringify(data), { qos: 0, retain: true }, error => {
      if (error) {
        console.error(error);
      } else {
        console.log('mqtt:Published');
      }
    });
  });

  setTimeout(() => client.end(), 2000);

  await new Promise(resolve => setTimeout(() => resolve('done!'), 2000));
}

/**
 * 显示运行信息
 */
async function showNotice() {
  console.log('');
  console.log(`运行模式: ${isQinglong ? '青龙面板' : '独立运行'}`);
}

/******************************************
 * 第十二部分：主程序入口
 * 
 * 脚本的主要执行流程
 ******************************************/

(async () => {
  /**
   * 检查账号密码是否配置
   */
  if ((await showNotice(), !USERNAME || !PASSWORD)) {
    console.log('❌ 请先配置网上国网账号密码!');
    console.log('独立运行: 复制 config.env.example 为 config.env 并配置');
    console.log('青龙面板: 设置环境变量 WSGW_USERNAME 和 WSGW_PASSWORD');
    return;
  }

  /**
   * 主流程：
   * 1. 获取加密密钥
   * 2. 检查Token有效性（有效则跳过登录）
   * 3. 获取访问令牌
   * 4. 查询绑定信息
   * 5. 遍历每个电表，获取数据并发送
   */
  await getKeyCode();
  const tokenValid = await checkTokenValid();
  if (!tokenValid) {
    await doLogin();
    await getAuthcode();
  }
  await getAccessToken();
  await getBindInfo();

  /**
   * 根据配置筛选要查询的电表
   * 支持指定户号查询，多个户号用逗号分隔
   */
  const queryConsNo = process.env.QUERY_CONS_NO || '';
  let targetUserList = bindInfo.powerUserList;

  if (queryConsNo) {
    const consNoList = queryConsNo.split(',').map(s => s.trim()).filter(s => s);
    targetUserList = bindInfo.powerUserList.filter(user =>
      consNoList.includes(user.consNo) || consNoList.includes(user.consNo_dst)
    );
    console.log(`📋 指定查询户号: ${consNoList.join(', ')}`);
    console.log(`📋 匹配到 ${targetUserList.length} 个电表`);

    if (targetUserList.length === 0) {
      console.log('⚠️ 未找到匹配的电表，将查询所有绑定的电表');
      targetUserList = bindInfo.powerUserList;
    }
  }

  /**
   * 遍历用户绑定的所有电表
   * 依次获取每个电表的数据
   */
  for (let e = 0; e < targetUserList.length; e++) {
    const originalIndex = bindInfo.powerUserList.indexOf(targetUserList[e]);
    await getElcFee(originalIndex);
    await getDayElecQuantity(originalIndex);
    await getMonthElecQuantity(originalIndex);

    /**
     * 组装输出信息
     */
    const o = targetUserList[e],
      { dataInfo: r } = monthElecQuantity,
      { sevenEleList: s, totalPq: n } = dayElecQuantity;
    let a = '';
    eleBill.totalPq && (a += `本期电量: ${eleBill.totalPq}度`);
    eleBill.sumMoney && (a += `  账户余额: ${eleBill.sumMoney}元`);
    a += `\n截至日期: ${eleBill.date}`;
    r && r.totalEleNum && r.totalEleCost && (a += `\n年度用电: ${r.totalEleNum}度  累计花费: ${r.totalEleCost}元`);
    o.consNo_dst && (a += `\n户号信息: ${o.consNo_dst}${o.consName_dst ? `|${o.consName_dst}` : ''}`);
    o.orgName && (a += `\n供电单位: ${o.orgName}`);
    n && (a += `\n五日用电: ${n}度`);

    /**
     * 可选：显示最近每日用电详情
     */
    isTrue(SHOW_RECENT) &&
      s.forEach((e, o) => {
        Number(e.dayElePq) && (a += `\n${e.day}用电: ${e.dayElePq}度⚡`);
      });

    /**
     * 发送数据到MQTT
     */
    await sendMsg(SCRIPTNAME, eleBill, s, monthElecQuantity);
  }
  console.log('✅ 执行完成');
})()
  .catch(e => {
    /**
     * 错误处理
     * 如果遇到Token相关错误，清除缓存
     */
    /无效|失效|过期|重新获取|请求异常/.test(e) && (store.clear('95598_bizrt'), console.log('✅ 清理缓存数据成功'));
    log.error(e);
  })
  .finally(done);
