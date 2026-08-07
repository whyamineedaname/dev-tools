<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import CryptoJS from 'crypto-js'
import JSEncrypt from 'jsencrypt'

type ModuleId = 'base64' | 'url' | 'hash' | 'aes' | 'rsa' | 'unicode' | 'generate'

const activeTab = ref<ModuleId>('base64')
const tabs: { id: ModuleId; label: string }[] = [
  { id: 'base64', label: 'Base64' },
  { id: 'url', label: 'URL' },
  { id: 'hash', label: 'Hash' },
  { id: 'aes', label: 'AES' },
  { id: 'rsa', label: 'RSA' },
  { id: 'unicode', label: 'Unicode' },
  { id: 'generate', label: 'UUID / 密码' }
]

const errorMsg = ref('')
const successMsg = ref('')
let successTimer: ReturnType<typeof setTimeout> | null = null

function showError(msg: string) {
  errorMsg.value = msg
}

function showSuccess(msg: string) {
  successMsg.value = msg
  if (successTimer) clearTimeout(successTimer)
  successTimer = setTimeout(() => {
    successMsg.value = ''
  }, 2000)
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    showSuccess(`${label}已复制`)
  } catch {
    showError('复制失败')
  }
}

// ---------- Base64 ----------
const base64 = reactive({ input: '', output: '' })

function base64Encode() {
  try {
    base64.output = btoa(unescape(encodeURIComponent(base64.input)))
    errorMsg.value = ''
  } catch (e: any) {
    showError(`编码失败：${e.message}`)
  }
}

function base64Decode() {
  try {
    base64.output = decodeURIComponent(escape(atob(base64.input)))
    errorMsg.value = ''
  } catch (e: any) {
    showError(`解码失败：${e.message}`)
  }
}

// ---------- URL ----------
const url = reactive({ input: '', output: '', encodeAll: false })

function urlEncode() {
  try {
    if (url.encodeAll) {
      url.output = encodeURIComponentAll(url.input)
    } else {
      url.output = encodeURIComponent(url.input)
    }
    errorMsg.value = ''
  } catch (e: any) {
    showError(`编码失败：${e.message}`)
  }
}

function urlDecode() {
  try {
    url.output = decodeURIComponent(url.input)
    errorMsg.value = ''
  } catch (e: any) {
    showError(`解码失败：${e.message}`)
  }
}

// 完全编码模式：所有字符都转义（含代理对）
function encodeURIComponentAll(str: string): string {
  return Array.from(str)
    .map((char) => {
      const code = char.codePointAt(0)!
      if (code > 0xffff) {
        const c = code - 0x10000
        return (
          `%${((c >> 10) + 0xd800).toString(16).padStart(4, '0')}` +
          `%${((c & 0x3ff) + 0xdc00).toString(16).padStart(4, '0')}`
        )
      }
      return encodeURIComponent(char)
    })
    .join('')
}

// ---------- Hash ----------
const hash = reactive({ input: '', output: '' })
const hashAlgorithm = ref<'md5' | 'sha1' | 'sha256' | 'sha512'>('md5')
const hashAlgorithms = [
  { id: 'md5', label: 'MD5' },
  { id: 'sha1', label: 'SHA-1' },
  { id: 'sha256', label: 'SHA-256' },
  { id: 'sha512', label: 'SHA-512' }
] as const

function calculateHash() {
  try {
    let result: string
    switch (hashAlgorithm.value) {
      case 'md5':
        result = CryptoJS.MD5(hash.input).toString()
        break
      case 'sha1':
        result = CryptoJS.SHA1(hash.input).toString()
        break
      case 'sha256':
        result = CryptoJS.SHA256(hash.input).toString()
        break
      case 'sha512':
        result = CryptoJS.SHA512(hash.input).toString()
        break
    }
    hash.output = result
    errorMsg.value = ''
  } catch (e: any) {
    showError(`计算失败：${e.message}`)
  }
}

// ---------- AES ----------
const aes = reactive({ key: '', input: '', output: '' })
const aesKeyVisible = ref(false)

function aesEncrypt() {
  if (aes.key.length < 8) {
    showError('密钥长度至少为 8 个字符')
    return
  }
  try {
    aes.output = CryptoJS.AES.encrypt(aes.input, aes.key).toString()
    errorMsg.value = ''
  } catch (e: any) {
    showError(`加密失败：${e.message}`)
  }
}

function aesDecrypt() {
  if (aes.key.length < 8) {
    showError('密钥长度至少为 8 个字符')
    return
  }
  try {
    const decrypted = CryptoJS.AES.decrypt(aes.input, aes.key).toString(
      CryptoJS.enc.Utf8
    )
    if (!decrypted) throw new Error('解密失败，可能是密钥错误')
    aes.output = decrypted
    errorMsg.value = ''
  } catch (e: any) {
    showError(`解密失败：${e.message}`)
  }
}

function generateAesKey() {
  const length = 32
  const charset =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+~`|}{[]:;?><,./-='
  let key = ''
  for (let i = 0; i < length; i++) {
    key += charset.charAt(Math.floor(Math.random() * charset.length))
  }
  aes.key = key
  showSuccess('已生成随机密钥')
}

// ---------- RSA ----------
interface RsaKeyPair {
  publicKeyPem: string
  privateKeyPem: string
  publicKeyB64: string
  privateKeyB64: string
}

let rsaKeyPair: RsaKeyPair | null = null
const rsaLoading = ref(false)
const rsa = reactive({
  input: '',
  output: '',
  publicKey: '',
  privateKey: '',
  showKeysAsBase64: true
})

function displayKeys() {
  if (!rsaKeyPair) return
  rsa.publicKey = rsa.showKeysAsBase64 ? rsaKeyPair.publicKeyB64 : rsaKeyPair.publicKeyPem
  rsa.privateKey = rsa.showKeysAsBase64 ? rsaKeyPair.privateKeyB64 : rsaKeyPair.privateKeyPem
}

function toggleKeysFormat() {
  rsa.showKeysAsBase64 = !rsa.showKeysAsBase64
  displayKeys()
}

// 从主进程获取/生成密钥对（后台预生成，首次点击即返回）
async function generateRsaKeys() {
  rsaLoading.value = true
  try {
    const result = await window.electronAPI.crypto.generateRsaKeys()
    if (result.success) {
      rsaKeyPair = {
        publicKeyPem: result.publicKeyPem,
        privateKeyPem: result.privateKeyPem,
        publicKeyB64: result.publicKeyB64,
        privateKeyB64: result.privateKeyB64
      }
      rsa.showKeysAsBase64 = true
      displayKeys()
      errorMsg.value = ''
      showSuccess('已生成新的 RSA 密钥对')
    } else {
      showError(`生成密钥对失败：${result.error || '未知错误'}`)
    }
  } catch (e: any) {
    showError(`生成密钥对失败：${e.message}`)
  } finally {
    rsaLoading.value = false
  }
}

function pemFromB64(b64: string, type: 'public' | 'private'): string {
  const begin = type === 'public' ? '-----BEGIN PUBLIC KEY-----' : '-----BEGIN PRIVATE KEY-----'
  const end = type === 'public' ? '-----END PUBLIC KEY-----' : '-----END PRIVATE KEY-----'
  return `${begin}${atob(b64).replace(/(.{64})/g, '$1\n')}${end}`
}
function rsaEncrypt() {
  const pk = rsa.publicKey.trim()
  if (!pk) {
    showError('请先生成或粘贴公钥')
    return
  }
  try {
    const pem = pk.includes('BEGIN PUBLIC KEY') ? pk : pemFromB64(pk, 'public')
    const encrypt = new JSEncrypt()
    encrypt.setPublicKey(pem)
    const output = encrypt.encrypt(rsa.input)
    if (!output) throw new Error('加密失败，请检查公钥格式')
    rsa.output = output
    errorMsg.value = ''
  } catch (e: any) {
    showError(`加密失败：${e.message}`)
  }
}

function rsaDecrypt() {
  const ak = rsa.privateKey.trim()
  if (!ak) {
    showError('请先生成或粘贴私钥')
    return
  }
  try {
    const pem = ak.includes('BEGIN PRIVATE KEY') ? ak : pemFromB64(ak, 'private')
    const decrypt = new JSEncrypt()
    decrypt.setPrivateKey(pem)
    const output = decrypt.decrypt(rsa.input)
    if (!output) throw new Error('解密失败，请检查私钥格式')
    rsa.output = output
    errorMsg.value = ''
  } catch (e: any) {
    showError(`解密失败：${e.message}`)
  }
}

// ---------- Unicode ----------
const unicode = reactive({ input: '', output: '' })

function unicodeEncode() {
  try {
    unicode.output = Array.from(unicode.input)
      .map((char) => {
        const codePoint = char.codePointAt(0)!
        if (codePoint > 0xffff) {
          const c = codePoint - 0x10000
          return `\\u${((c >> 10) + 0xd800).toString(16).padStart(4, '0')}\\u${((c & 0x3ff) + 0xdc00).toString(16).padStart(4, '0')}`
        }
        return `\\u${codePoint.toString(16).padStart(4, '0')}`
      })
      .join('')
    errorMsg.value = ''
  } catch (e: any) {
    showError(`编码失败：${e.message}`)
  }
}

function unicodeDecode() {
  try {
    unicode.output = unicode.input.replace(
      /\\u([0-9A-Fa-f]{4})/g,
      (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16))
    )
    errorMsg.value = ''
  } catch (e: any) {
    showError(`解码失败：${e.message}`)
  }
}

// ---------- UUID / 随机密码 ----------
const uuidOpts = reactive({
  count: 1,
  upper: false,
  noHyphen: false,
  output: ''
})

const pwdOpts = reactive({
  length: 16,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
  output: ''
})

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}

function createUuidV4(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = randomBytes(16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function generateUuids() {
  try {
    const count = Math.min(100, Math.max(1, Math.floor(Number(uuidOpts.count) || 1)))
    uuidOpts.count = count
    const list: string[] = []
    for (let i = 0; i < count; i++) {
      let id = createUuidV4()
      if (uuidOpts.noHyphen) id = id.replace(/-/g, '')
      if (uuidOpts.upper) id = id.toUpperCase()
      list.push(id)
    }
    uuidOpts.output = list.join('\n')
    errorMsg.value = ''
  } catch (e: unknown) {
    showError(`生成失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

function buildPasswordCharset(): string {
  let charset = ''
  if (pwdOpts.upper) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  if (pwdOpts.lower) charset += 'abcdefghijklmnopqrstuvwxyz'
  if (pwdOpts.digits) charset += '0123456789'
  if (pwdOpts.symbols) charset += '!@#$%^&*()-_=+[]{};:,.?/'
  if (pwdOpts.excludeAmbiguous) {
    charset = charset.replace(/[0OIl1]/g, '')
  }
  return charset
}

function generatePassword() {
  try {
    const length = Math.min(128, Math.max(4, Math.floor(Number(pwdOpts.length) || 16)))
    pwdOpts.length = length
    const charset = buildPasswordCharset()
    if (!charset) {
      showError('请至少勾选一种字符类型')
      return
    }
    const bytes = randomBytes(length)
    let password = ''
    for (let i = 0; i < length; i++) {
      password += charset[bytes[i] % charset.length]
    }
    pwdOpts.output = password
    errorMsg.value = ''
  } catch (e: unknown) {
    showError(`生成失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

// 初始化：异步获取主进程后台预生成的密钥对，不阻塞组件渲染
onMounted(() => {
  generateRsaKeys()
})
</script>

<template>
  <div class="crypto-tool">
    <div class="algo-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="algo-btn"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="errorMsg" class="error-bar">
      ⚠️ {{ errorMsg }}
    </div>
    <div v-if="successMsg" class="success-bar">
      ✓ {{ successMsg }}
    </div>

    <!-- ===== Base64 ===== -->
    <div v-if="activeTab === 'base64'" class="panel">
      <div class="field">
        <label class="field-label">输入文本</label>
        <textarea v-model="base64.input" class="text-input" rows="5" placeholder="请输入需要进行 Base64 加解密的文本..." />
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" @click="base64Encode">🔒 编码</button>
        <button class="btn" @click="base64Decode">🔓 解码</button>
        <button class="btn" @click="base64.input = ''; base64.output = ''">🧹 清空</button>
      </div>
      <div class="field">
        <div class="field-header">
          <label class="field-label">结果</label>
          <button class="copy-btn" @click="copyText(base64.output, 'Base64 结果')">复制</button>
        </div>
        <textarea v-model="base64.output" class="text-input" rows="5" readonly placeholder="结果将显示在这里..." />
      </div>
    </div>

    <!-- ===== URL ===== -->
    <div v-if="activeTab === 'url'" class="panel">
      <div class="field">
        <label class="field-label">输入文本</label>
        <textarea v-model="url.input" class="text-input" rows="5" placeholder="请输入需要进行 URL 编码/解码的文本..." />
      </div>
      <div class="option-row">
        <input id="url-encode-all" v-model="url.encodeAll" type="checkbox" class="option-checkbox" />
        <label for="url-encode-all" class="option-label">完全编码模式（所有字符转义）</label>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" @click="urlEncode">🔗 编码</button>
        <button class="btn" @click="urlDecode">🔗 解码</button>
        <button class="btn" @click="url.input = ''; url.output = ''">🧹 清空</button>
      </div>
      <div class="field">
        <div class="field-header">
          <label class="field-label">结果</label>
          <button class="copy-btn" @click="copyText(url.output, 'URL 结果')">复制</button>
        </div>
        <textarea v-model="url.output" class="text-input" rows="5" readonly placeholder="结果将显示在这里..." />
      </div>
    </div>

    <!-- ===== Hash ===== -->
    <div v-if="activeTab === 'hash'" class="panel">
      <div class="algorithm-selector">
        <button
          v-for="algo in hashAlgorithms"
          :key="algo.id"
          class="algo-btn"
          :class="{ active: hashAlgorithm === algo.id }"
          @click="hashAlgorithm = algo.id"
        >
          {{ algo.label }}
        </button>
      </div>
      <div class="field">
        <label class="field-label">输入文本</label>
        <textarea v-model="hash.input" class="text-input" rows="5" placeholder="请输入需要计算 Hash 值的文本..." />
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" @click="calculateHash">🧮 计算</button>
        <button class="btn" @click="hash.input = ''; hash.output = ''">🧹 清空</button>
      </div>
      <div class="field">
        <div class="field-header">
          <label class="field-label">Hash 值</label>
          <button class="copy-btn" @click="copyText(hash.output, 'Hash 值')">复制</button>
        </div>
        <textarea v-model="hash.output" class="text-input" rows="3" readonly placeholder="结果将显示在这里..." />
      </div>
    </div>

    <!-- ===== AES ===== -->
    <div v-if="activeTab === 'aes'" class="panel">
      <div class="field">
        <label class="field-label">密钥（至少 8 个字符）</label>
        <div class="key-input-row">
          <input
            v-model="aes.key"
            :type="aesKeyVisible ? 'text' : 'password'"
            class="text-input key-input"
            placeholder="请输入加密/解密密钥..."
          />
          <button class="btn" @click="aesKeyVisible = !aesKeyVisible">
            {{ aesKeyVisible ? '🙈 隐藏' : '👁️ 显示' }}
          </button>
          <button class="btn btn-primary" @click="generateAesKey">🎲 生成随机密钥</button>
        </div>
      </div>
      <div class="field">
        <label class="field-label">输入文本</label>
        <textarea v-model="aes.input" class="text-input" rows="4" placeholder="请输入需要加密/解密的文本..." />
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" @click="aesEncrypt">🔒 加密</button>
        <button class="btn" @click="aesDecrypt">🔓 解密</button>
        <button class="btn" @click="aes.input = ''; aes.output = ''">🧹 清空</button>
      </div>
      <div class="field">
        <div class="field-header">
          <label class="field-label">结果</label>
          <button class="copy-btn" @click="copyText(aes.output, 'AES 结果')">复制</button>
        </div>
        <textarea v-model="aes.output" class="text-input" rows="4" readonly placeholder="结果将显示在这里..." />
      </div>
    </div>

    <!-- ===== RSA ===== -->
    <div v-if="activeTab === 'rsa'" class="panel">
      <div class="field">
        <div class="field-header">
          <label class="field-label">密钥对（RSA-2048）</label>
          <button class="btn btn-primary" :disabled="rsaLoading" @click="generateRsaKeys">
            {{ rsaLoading ? '⏳ 生成中...' : '🔑 生成新密钥对' }}
          </button>
        </div>
        <div v-if="rsaLoading && !rsaKeyPair" class="rsa-placeholder">
          <span class="loading-spinner"></span>
          正在从后台加载密钥对...
        </div>
        <div v-else class="rsa-keys">
          <div class="rsa-key-col">
            <div class="field-header">
              <label class="field-label">公钥（用于加密）</label>
              <button class="copy-btn" @click="copyText(rsa.publicKey, '公钥')">复制</button>
            </div>
            <textarea v-model="rsa.publicKey" class="text-input key-display" rows="6" placeholder="公钥将显示在这里..." />
          </div>
          <div class="rsa-key-col">
            <div class="field-header">
              <label class="field-label">私钥（用于解密）</label>
              <button class="copy-btn" @click="copyText(rsa.privateKey, '私钥')">复制</button>
            </div>
            <textarea v-model="rsa.privateKey" class="text-input key-display" rows="6" placeholder="私钥将显示在这里..." />
          </div>
        </div>
        <button class="btn toggle-format-btn" @click="toggleKeysFormat">
          {{ rsa.showKeysAsBase64 ? '切换为 PEM 格式' : '切换为 Base64 格式' }}
        </button>
      </div>
      <div class="field">
        <label class="field-label">输入文本</label>
        <textarea v-model="rsa.input" class="text-input" rows="4" placeholder="请输入需要加密/解密的文本..." />
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" @click="rsaEncrypt">🔒 加密（使用公钥）</button>
        <button class="btn" @click="rsaDecrypt">🔓 解密（使用私钥）</button>
        <button class="btn" @click="rsa.input = ''; rsa.output = ''">🧹 清空</button>
      </div>
      <div class="field">
        <div class="field-header">
          <label class="field-label">结果</label>
          <button class="copy-btn" @click="copyText(rsa.output, 'RSA 结果')">复制</button>
        </div>
        <textarea v-model="rsa.output" class="text-input" rows="4" readonly placeholder="结果将显示在这里..." />
      </div>
    </div>

    <!-- ===== Unicode ===== -->
    <div v-if="activeTab === 'unicode'" class="panel">
      <div class="field">
        <label class="field-label">输入文本</label>
        <textarea v-model="unicode.input" class="text-input" rows="5" placeholder="请输入需要进行 Unicode 编码/解码的文本..." />
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" @click="unicodeEncode">🔤 编码</button>
        <button class="btn" @click="unicodeDecode">🔤 解码</button>
        <button class="btn" @click="unicode.input = ''; unicode.output = ''">🧹 清空</button>
      </div>
      <div class="field">
        <div class="field-header">
          <label class="field-label">结果</label>
          <button class="copy-btn" @click="copyText(unicode.output, 'Unicode 结果')">复制</button>
        </div>
        <textarea v-model="unicode.output" class="text-input" rows="5" readonly placeholder="结果将显示在这里..." />
      </div>
    </div>

    <!-- ===== UUID / 随机密码 ===== -->
    <div v-if="activeTab === 'generate'" class="panel">
      <section class="gen-section">
        <h3 class="gen-title">UUID v4</h3>
        <div class="gen-controls">
          <label class="gen-inline">
            数量
            <input v-model.number="uuidOpts.count" class="num-input" type="number" min="1" max="100" />
          </label>
          <label class="option-row compact">
            <input v-model="uuidOpts.upper" type="checkbox" class="option-checkbox" />
            <span class="option-label">大写</span>
          </label>
          <label class="option-row compact">
            <input v-model="uuidOpts.noHyphen" type="checkbox" class="option-checkbox" />
            <span class="option-label">去掉连字符</span>
          </label>
        </div>
        <div class="btn-group">
          <button type="button" class="btn btn-primary" @click="generateUuids">生成 UUID</button>
          <button type="button" class="btn" @click="uuidOpts.output = ''">清空</button>
        </div>
        <div class="field">
          <div class="field-header">
            <label class="field-label">结果</label>
            <button type="button" class="copy-btn" @click="copyText(uuidOpts.output, 'UUID')">复制</button>
          </div>
          <textarea
            v-model="uuidOpts.output"
            class="text-input"
            rows="5"
            readonly
            placeholder="点击生成 UUID..."
          />
        </div>
      </section>

      <section class="gen-section">
        <h3 class="gen-title">随机密码</h3>
        <div class="gen-controls">
          <label class="gen-inline">
            长度
            <input v-model.number="pwdOpts.length" class="num-input" type="number" min="4" max="128" />
          </label>
          <label class="option-row compact">
            <input v-model="pwdOpts.upper" type="checkbox" class="option-checkbox" />
            <span class="option-label">大写 A-Z</span>
          </label>
          <label class="option-row compact">
            <input v-model="pwdOpts.lower" type="checkbox" class="option-checkbox" />
            <span class="option-label">小写 a-z</span>
          </label>
          <label class="option-row compact">
            <input v-model="pwdOpts.digits" type="checkbox" class="option-checkbox" />
            <span class="option-label">数字</span>
          </label>
          <label class="option-row compact">
            <input v-model="pwdOpts.symbols" type="checkbox" class="option-checkbox" />
            <span class="option-label">符号</span>
          </label>
          <label class="option-row compact">
            <input v-model="pwdOpts.excludeAmbiguous" type="checkbox" class="option-checkbox" />
            <span class="option-label">排除易混字符 (0OIl1)</span>
          </label>
        </div>
        <div class="btn-group">
          <button type="button" class="btn btn-primary" @click="generatePassword">生成密码</button>
          <button type="button" class="btn" @click="pwdOpts.output = ''">清空</button>
        </div>
        <div class="field">
          <div class="field-header">
            <label class="field-label">结果</label>
            <button type="button" class="copy-btn" @click="copyText(pwdOpts.output, '密码')">复制</button>
          </div>
          <textarea
            v-model="pwdOpts.output"
            class="text-input mono"
            rows="3"
            readonly
            placeholder="点击生成随机密码..."
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.crypto-tool {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.algo-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  background: #fafafa;
}

.algo-btn {
  padding: 5px 14px;
  font-size: 13px;
  border-radius: 999px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  background: #fff;
  border-color: #dcdfe6;
  color: #606266;
}

.algo-btn:hover {
  color: #ff5c9d;
  border-color: #ffc2d9;
  background: #ffe8f1;
}

.algo-btn.active {
  background: #ff7eb6;
  border-color: #ff7eb6;
  color: #fff;
}

.panel {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.field {
  margin-bottom: 14px;
}

.field-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.field-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #606266;
  margin-bottom: 6px;
}

.text-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 13px;
  font-family: 'Consolas', 'Monaco', monospace;
  box-sizing: border-box;
  resize: vertical;
  transition: border-color 0.2s;
}

.text-input:focus {
  outline: none;
  border-color: #ff7eb6;
}

.text-input[readonly] {
  background: #fafafa;
  color: #303133;
}

.btn-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.btn {
  padding: 6px 14px;
  font-size: 13px;
  border-radius: 4px;
  background: #fff;
  border: 1px solid #dcdfe6;
  color: #606266;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn:hover {
  color: #ff7eb6;
  border-color: #ffc2d9;
  background: #ffe8f1;
}

.btn-primary {
  background: #ff7eb6;
  border-color: #ff7eb6;
  color: #fff;
}

.btn-primary:hover {
  background: #ff5c9d;
  border-color: #ff5c9d;
  color: #fff;
}

.copy-btn {
  padding: 3px 10px;
  font-size: 12px;
  border-radius: 4px;
  background: #f5f7fa;
  border: 1px solid #dcdfe6;
  color: #606266;
  cursor: pointer;
  transition: all 0.2s;
}

.copy-btn:hover {
  background: #ffe8f1;
  border-color: #ffc2d9;
  color: #ff5c9d;
}

.error-bar {
  padding: 10px 16px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 13px;
  border-bottom: 1px solid #fbc4c4;
}

.success-bar {
  padding: 10px 16px;
  background: #f0f9eb;
  color: #67c23a;
  font-size: 13px;
  border-bottom: 1px solid #e1f3d8;
}

.option-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.option-row.compact {
  margin-bottom: 0;
}

.option-checkbox {
  accent-color: #ff7eb6;
}

.option-label {
  font-size: 13px;
  color: #606266;
}

.gen-section {
  margin-bottom: 22px;
  padding-bottom: 18px;
  border-bottom: 1px dashed #eee;
}

.gen-section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.gen-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.gen-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  margin-bottom: 14px;
}

.gen-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #606266;
}

.num-input {
  width: 72px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 13px;
}

.text-input.mono {
  font-family: Consolas, 'Courier New', monospace;
  letter-spacing: 0.02em;
}

.algorithm-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.key-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.key-input {
  flex: 1;
}

.rsa-keys {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}

.rsa-placeholder {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px;
  background: #f5f7fa;
  border-radius: 6px;
  color: #909399;
  font-size: 13px;
  margin-bottom: 10px;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #ffc2d9;
  border-top-color: #ff7eb6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.rsa-key-col {
  flex: 1;
  min-width: 0;
}

.key-display {
  font-size: 12px;
}

.toggle-format-btn {
  margin-bottom: 4px;
}
</style>
