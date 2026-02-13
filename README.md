# State Grid Electricity Info

国家电网用电信息获取脚本，支持独立运行和青龙面板，配合 MQTT 在 Home Assistant 中统计用电数据。

> � **感谢原作者 [Yuheng](https://github.com/x2rr) 提供的原始脚本！**
>
> 本项目基于 [state-grid](https://github.com/Yuheng-Li/state-grid) 进行二次开发，增加了以下功能：
> - ✅ 支持独立运行（脱离青龙面板）
> - ✅ 环境变量配置文件支持
> - ✅ 历史数据持久化存储（JSON）
> - ✅ MQTT 可选配置
> - ✅ Token 缓存机制
> - ✅ 自定义查询时间范围
> - ✅ 指定户号查询

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 多电表支持 | 支持查询账号下绑定的所有电表 |
| 独立运行 | 无需青龙面板，可直接通过 Node.js 运行 |
| 历史数据存储 | 支持 JSON 文件存储历史用电数据 |
| Token 缓存 | 避免频繁登录，可配置缓存有效期 |
| 自定义查询 | 支持指定查询天数或日期范围 |
| 户号筛选 | 支持只查询指定的电表户号 |
| MQTT 推送 | 可选的 MQTT 数据推送，支持 Home Assistant 集成 |

---

## 快速开始

### 方式一：独立运行

#### 1. 安装依赖

```bash
git clone <your-repo-url>
cd state-grid
npm install
```

#### 2. 配置环境变量

```bash
cp config.env.example config.env
```

编辑 `config.env` 文件，填写必要信息：

```env
# 必填：网上国网账号密码
WSGW_USERNAME=your_username
WSGW_PASSWORD=your_password

# MQTT配置（可选）
MQTT_ENABLED=true
WSGW_mqtt_host=192.168.1.100
WSGW_mqtt_port=1883
WSGW_mqtt_username=
WSGW_mqtt_password=
```

#### 3. 运行脚本

```bash
npm start
# 或
node state-grid-multiple.js
```

### 方式二：青龙面板

#### 1. 添加脚本

将 `state-grid-multiple.js` 添加到青龙面板的脚本目录

#### 2. 配置环境变量

在青龙面板的「配置文件」或「环境变量」中添加：

```
# 必填：网上国网账号密码
export WSGW_USERNAME="your_username"
export WSGW_PASSWORD="your_password"

# MQTT配置
export MQTT_ENABLED="true"
export WSGW_mqtt_host="192.168.1.100"
export WSGW_mqtt_port="1883"
export WSGW_mqtt_username=""
export WSGW_mqtt_password=""

# 数据存储配置
export DATA_STORE_DIR="/ql/data/scripts/data"
export SAVE_HISTORY_DATA="true"
export HISTORY_RETENTION_DAYS="365"
export TOKEN_CACHE_HOURS="24"

# 查询配置（可选）
export QUERY_DAYS="7"
export QUERY_START_DATE=""
export QUERY_END_DATE=""
export QUERY_CONS_NO=""
```

#### 3. 添加定时任务

在青龙面板添加定时任务，建议每天执行一次：

```
0 8 * * * node /ql/scripts/state-grid-multiple.js
```

---

## 环境变量说明

### 必填配置

| 变量 | 说明 | 示例 |
|------|------|------|
| `WSGW_USERNAME` | 网上国网账号（手机号） | `13812345678` |
| `WSGW_PASSWORD` | 网上国网密码 | `your_password` |

### MQTT 配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MQTT_ENABLED` | 是否启用 MQTT 推送 | `true` |
| `WSGW_mqtt_host` | MQTT 服务器地址 | - |
| `WSGW_mqtt_port` | MQTT 服务器端口 | `1883` |
| `WSGW_mqtt_username` | MQTT 用户名 | - |
| `WSGW_mqtt_password` | MQTT 密码 | - |

### 数据存储配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATA_STORE_DIR` | 数据存储目录 | `./data` |
| `SAVE_HISTORY_DATA` | 是否保存历史数据 | `true` |
| `HISTORY_RETENTION_DAYS` | 历史数据保留天数 | `365` |
| `TOKEN_CACHE_HOURS` | Token 缓存有效期（小时） | `24` |

### 查询配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `QUERY_DAYS` | 日用电量查询天数 | `7` |
| `QUERY_START_DATE` | 自定义开始日期（YYYY-MM-DD） | - |
| `QUERY_END_DATE` | 自定义结束日期（YYYY-MM-DD） | 昨天 |
| `QUERY_CONS_NO` | 指定查询的用电户号（多个用逗号分隔） | - |

---

## 数据存储

数据存储在 `data/history_data.json` 文件中，支持：

- 历史用电数据持久化
- 数据去重
- 自动清理过期数据

---

## Home Assistant 配置

### MQTT 传感器配置

订阅主题: `nodejs/state-grid/{用电户号}`

在 `configuration.yaml` 中添加：

```yaml
mqtt:
  sensor:
    - name: "电费余额"
      icon: 'mdi:lightning-bolt'
      unique_id: 'yong_dian_xin_xi_1111111111111'
      state_topic: "nodejs/state-grid/1111111111111"
      value_template: "{{ value_json.sumMoney }}"
      unit_of_measurement: '元'
      json_attributes_topic: "nodejs/state-grid/1111111111111"
      json_attributes_template: "{{ value_json | tojson }}"
      device:
        identifiers: ["mqtt1111111111111"]
        name: "用电信息-1111111111111"
    - name: 'Electricity Usage Day 1'
      state_topic: 'nodejs/state-grid/1111111111111'
      value_template: '{{ value_json.dayList[0].dayElePq }}'
      unique_id: "electricity_usage_day1_1111111111111"
      device_class: "energy"
      unit_of_measurement: "度"
      icon: "mdi:chart-bell-curve"
      json_attributes_topic: "nodejs/state-grid/1111111111111"
      json_attributes_template: "{{ value_json.dayList[0] | tojson }}"
      device:
        identifiers: ["mqtt1111111111111"]
        name: "用电信息-1111111111111"
```

> 将 `1111111111111` 替换为实际用电户号

### Lovelace 卡片示例

#### 用电概况统计

```yaml
type: vertical-stack
cards:
  - type: grid
    columns: 2
    cards:
      - type: entity
        entity: sensor.yong_dian_xin_xi_1111111111111_dian_fei_yu_e
        name: 电费余额
        attribute: sumMoney
        unit: 元
        icon: mdi:currency-usd
      - type: entity
        entity: sensor.yong_dian_xin_xi_1111111111111_electricity_usage_day_1
        name: 昨日用电
        icon: mdi:lightning-bolt
      - type: entity
        entity: sensor.yong_dian_xin_xi_1111111111111_dian_fei_yu_e
        name: 年度总电费
        attribute: totalEleCost
        unit: 元
        icon: mdi:currency-usd
      - type: entity
        entity: sensor.yong_dian_xin_xi_1111111111111_dian_fei_yu_e
        name: 年度总电量
        unit: 度
        icon: mdi:lightning-bolt
    square: false
title: 用电统计
```

#### 日用电图表

```yaml
type: custom:apexcharts-card
graph_span: 30d
span:
  end: day
header:
  show: true
  title: 最近30天电量统计数据
  show_states: true
  colorize_states: true
series:
  - entity: sensor.yong_dian_xin_xi_1111111111111_dian_fei_yu_e
    name: 用电量
    unit: 度
    type: column
    float_precision: 2
    data_generator: |
      return entity.attributes.dayList.reverse().map((peak, index) => {
        return [entity.attributes.dayList[index].day, entity.attributes.dayList[index].dayElePq];
      });
yaxis:
  - min: 0
```

#### 月用电图表

```yaml
type: custom:apexcharts-card
graph_span: 12month
header:
  show: true
  title: 最近12个月电量统计数据
  show_states: true
  colorize_states: true
series:
  - entity: sensor.yong_dian_xin_xi_1111111111111_dian_fei_yu_e
    name: 用电量
    unit: 度
    type: column
    data_generator: |
      return entity.attributes.monthList.map((peak, index) => {
        return [entity.attributes.monthList[index].endDate, entity.attributes.monthList[index].monthEleNum];
      });
```

---

## 数据结构

### MQTT 推送数据格式

```json
{
  "consNo": "1111111111111",
  "sumMoney": "123.45",
  "totalPq": "15.6",
  "date": "2024-01-15",
  "dayList": [
    { "day": "2024-01-15", "dayElePq": "15.6", "dayEleCost": "7.62" },
    { "day": "2024-01-14", "dayElePq": "12.3", "dayEleCost": "6.01" }
  ],
  "monthList": [
    { "month": "2024-01", "monthElePq": "456.7", "monthEleCost": "222.95" }
  ],
  "totalEleNum": "1234.5",
  "totalEleCost": "603.12"
}
```

---

## 常见问题

### 1. Token 验证失败

Token 有效期默认为 24 小时，可通过 `TOKEN_CACHE_HOURS` 调整。如果频繁失败，检查账号密码是否正确。

### 2. MQTT 连接失败

- 检查 MQTT 服务器地址和端口是否正确
- 确认 MQTT 服务已启动
- 如果不需要 MQTT，可禁用：

```env
MQTT_ENABLED=false
```

---

## 项目结构

```
state-grid/
├── state-grid-multiple.js   # 主脚本
├── config.env.example       # 环境变量示例
├── package.json             # 依赖配置
├── data/                    # 数据存储目录
│   └── history_data.json    # 历史数据
└── store/                   # Token 缓存目录
```

---

## 致谢

- 原作者 [Yuheng](https://github.com/x2rr) - [state-grid](https://github.com/x2rr/state-grid)
- 中转服务器 API 提供者

---

## License

MIT
