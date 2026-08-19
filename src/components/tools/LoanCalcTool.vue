<script setup lang="ts">
import { computed, ref } from 'vue'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

// ============================================================
// 类型定义
// ============================================================
interface AdjustmentItem {
  type: 'prepayment' | 'rateChange' | 'both'
  period: number | null
  prepaymentAmount: number | null
  newRate: number | null
}

interface AdjustmentData {
  period: number
  prepaymentAmount?: number
  newRate?: number
}

interface MonthlyDetail {
  period: number
  principal: number
  interest: number
  payment: number
  remaining: number
  prepayment: number
  rateChanged: boolean
}

interface CalcResult {
  totalPayment: number
  totalInterest: number
  firstMonthPayment: number
  monthlyDetails: MonthlyDetail[]
  yearlySummary: { year: number; amount: number }[]
  loanInfo: string
}

type RepayMode = 'equalPrincipalInterest' | 'equalPrincipal'

// ============================================================
// 输入状态
// ============================================================
const loanAmount = ref<number>(390000)
const annualRate = ref<number>(3.5)
const loanPeriods = ref<number>(180)
const adjustments = ref<AdjustmentItem[]>([
  { type: 'prepayment', period: null, prepaymentAmount: null, newRate: null }
])

// ============================================================
// 结果状态
// ============================================================
const result = ref<CalcResult | null>(null)
const resultTitle = ref('')
const errorMsg = ref('')
const activeTab = ref<'monthly' | 'yearly'>('monthly')

// ============================================================
// PDF 导出状态
// ============================================================
const exporting = ref(false)
const exportStatus = ref<'success' | 'error' | ''>('')

/** 中文字体 base64 缓存（simhei.ttf，模块级只读一次） */
let cnFontBase64: string | null = null
let cnFontChecked = false

async function loadCnFont(): Promise<string | null> {
  if (cnFontChecked) return cnFontBase64
  cnFontChecked = true
  try {
    const res = await window.electronAPI.file.readBinary('C:\\Windows\\Fonts\\simhei.ttf')
    if (res.success && res.base64) {
      cnFontBase64 = res.base64
    }
  } catch {
    cnFontBase64 = null
  }
  return cnFontBase64
}

// ============================================================
// 工具函数
// ============================================================
function roundNumber(num: number, decimalPlaces = 2): number {
  return Math.round(num * Math.pow(10, decimalPlaces)) / Math.pow(10, decimalPlaces)
}

function formatNumber(num: number): string {
  return num.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')
}

/** 收集所有有效的调整项数据（按期数排序） */
function getAdjustmentsData(): AdjustmentData[] {
  const list: AdjustmentData[] = []
  for (const item of adjustments.value) {
    const period = Math.floor(Number(item.period) || 0)
    if (period <= 0) continue
    const adj: AdjustmentData = { period }
    if ((item.type === 'prepayment' || item.type === 'both') && Number(item.prepaymentAmount) > 0) {
      adj.prepaymentAmount = Number(item.prepaymentAmount)
    }
    if ((item.type === 'rateChange' || item.type === 'both') && Number(item.newRate) > 0) {
      adj.newRate = Number(item.newRate)
    }
    if (Object.keys(adj).length > 1) list.push(adj)
  }
  return list.sort((a, b) => a.period - b.period)
}

// ============================================================
// 计算逻辑（等额本金，支持多组提前还款/利率调整）
// ============================================================
function calculateEqualPrincipal(amount: number, rate: number, totalMonths: number): CalcResult {
  let monthlyRate = roundNumber(rate / 100 / 12, 8)
  let remainingPrincipal = amount
  let totalPayment = 0
  let totalInterest = 0
  const monthlyDetails: MonthlyDetail[] = []
  const yearlySummary = new Array<number>(Math.ceil(totalMonths / 12)).fill(0)
  let currentAnnualRate = rate
  let adjustedTotalMonths = totalMonths
  const adjustmentsData = getAdjustmentsData()

  for (let month = 1; month <= adjustedTotalMonths; month++) {
    const yearIndex = Math.ceil(month / 12) - 1
    let prepayAmount = 0
    let rateChanged = false
    let currentRemainingPrincipal = remainingPrincipal

    const currentAdjustment = adjustmentsData.find(adj => adj.period === month)
    if (currentAdjustment) {
      // 提前还款：当期还款前先扣减
      if (currentAdjustment.prepaymentAmount) {
        prepayAmount = currentAdjustment.prepaymentAmount
        currentRemainingPrincipal = roundNumber(Math.max(0, currentRemainingPrincipal - prepayAmount))
        totalPayment += prepayAmount
        yearlySummary[yearIndex] += prepayAmount
      }
      // 利率调整：当期生效
      if (currentAdjustment.newRate) {
        currentAnnualRate = currentAdjustment.newRate
        monthlyRate = roundNumber(currentAnnualRate / 100 / 12, 8)
        rateChanged = true
      }
    }

    // 剩余本金均分至剩余月份（含本期）
    const remainingMonths = adjustedTotalMonths - month + 1
    const monthlyPrincipal = roundNumber(currentRemainingPrincipal / remainingMonths)
    const monthlyInterest = roundNumber(currentRemainingPrincipal * monthlyRate)
    const monthlyPayment = roundNumber(monthlyPrincipal + monthlyInterest)
    const finalRemaining = roundNumber(Math.max(0, currentRemainingPrincipal - monthlyPrincipal))

    monthlyDetails.push({
      period: month,
      principal: monthlyPrincipal,
      interest: monthlyInterest,
      payment: monthlyPayment,
      remaining: finalRemaining,
      prepayment: prepayAmount,
      rateChanged
    })

    totalPayment += monthlyPayment
    totalInterest += monthlyInterest
    yearlySummary[yearIndex] += monthlyPayment
    remainingPrincipal = finalRemaining

    if (remainingPrincipal <= 0.01) {
      adjustedTotalMonths = month
      break
    }
  }

  const formattedYearly = yearlySummary
    .map((amount, index) => ({ year: index + 1, amount: roundNumber(amount) }))
    .filter(item => item.amount > 0)

  return {
    totalPayment: roundNumber(totalPayment),
    totalInterest: roundNumber(totalInterest),
    firstMonthPayment: monthlyDetails[0]?.payment || 0,
    monthlyDetails,
    yearlySummary: formattedYearly,
    loanInfo: buildLoanInfo(amount, rate, currentAnnualRate, totalMonths)
  }
}

// ============================================================
// 计算逻辑（等额本息，提前还款后重算后续月供）
// ============================================================
function calculateEqualPrincipalInterest(amount: number, rate: number, totalMonths: number): CalcResult {
  let monthlyRate = roundNumber(rate / 100 / 12, 8)
  let remainingPrincipal = amount
  let totalPayment = 0
  let totalInterest = 0
  const monthlyDetails: MonthlyDetail[] = []
  const yearlySummary = new Array<number>(Math.ceil(totalMonths / 12)).fill(0)
  let currentAnnualRate = rate
  let adjustedTotalMonths = totalMonths
  const adjustmentsData = getAdjustmentsData()

  for (let month = 1; month <= adjustedTotalMonths; month++) {
    const yearIndex = Math.ceil(month / 12) - 1
    let prepayAmount = 0
    let rateChanged = false
    let currentRemainingPrincipal = remainingPrincipal

    const currentAdjustment = adjustmentsData.find(adj => adj.period === month)
    if (currentAdjustment) {
      if (currentAdjustment.prepaymentAmount) {
        prepayAmount = currentAdjustment.prepaymentAmount
        currentRemainingPrincipal = roundNumber(Math.max(0, currentRemainingPrincipal - prepayAmount))
        totalPayment += prepayAmount
        yearlySummary[yearIndex] += prepayAmount
      }
      if (currentAdjustment.newRate) {
        currentAnnualRate = currentAdjustment.newRate
        monthlyRate = roundNumber(currentAnnualRate / 100 / 12, 8)
        rateChanged = true
      }
    }

    // 提前还款后按剩余本金与剩余期数重算月供
    const remainingMonths = adjustedTotalMonths - month + 1
    const pow = Math.pow(1 + monthlyRate, remainingMonths)
    const monthlyPaymentFactor = monthlyRate * pow / (pow - 1)
    const monthlyPayment = roundNumber(currentRemainingPrincipal * monthlyPaymentFactor)
    const monthlyInterest = roundNumber(currentRemainingPrincipal * monthlyRate)
    const monthlyPrincipal = roundNumber(monthlyPayment - monthlyInterest)
    const finalRemaining = roundNumber(Math.max(0, currentRemainingPrincipal - monthlyPrincipal))

    monthlyDetails.push({
      period: month,
      principal: monthlyPrincipal,
      interest: monthlyInterest,
      payment: monthlyPayment,
      remaining: finalRemaining,
      prepayment: prepayAmount,
      rateChanged
    })

    totalPayment += monthlyPayment
    totalInterest += monthlyInterest
    yearlySummary[yearIndex] += monthlyPayment
    remainingPrincipal = finalRemaining

    if (remainingPrincipal <= 0.01) {
      adjustedTotalMonths = month
      break
    }
  }

  const formattedYearly = yearlySummary
    .map((amount, index) => ({ year: index + 1, amount: roundNumber(amount) }))
    .filter(item => item.amount > 0)

  return {
    totalPayment: roundNumber(totalPayment),
    totalInterest: roundNumber(totalInterest),
    firstMonthPayment: monthlyDetails[0]?.payment || 0,
    monthlyDetails,
    yearlySummary: formattedYearly,
    loanInfo: buildLoanInfo(amount, rate, currentAnnualRate, totalMonths)
  }
}

function buildLoanInfo(amount: number, rate: number, finalRate: number, totalMonths: number): string {
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  const periodText = months ? `${years}年 ${months}个月` : `${years}年`
  return `${amount.toLocaleString()}元 | ${rate}% → ${finalRate}% | ${totalMonths}期（${periodText}）`
}

// ============================================================
// 交互逻辑
// ============================================================
function calc(mode: RepayMode) {
  const amount = Number(loanAmount.value) || 0
  const rate = Number(annualRate.value) || 0
  const periods = Math.floor(Number(loanPeriods.value) || 0)

  if (amount <= 0 || periods <= 0) {
    errorMsg.value = '请输入有效的贷款金额与期数！'
    return
  }
  if (mode === 'equalPrincipalInterest' && rate <= 0) {
    errorMsg.value = '等额本息需要输入有效的年利率！'
    return
  }
  errorMsg.value = ''
  exportStatus.value = ''

  if (mode === 'equalPrincipal') {
    resultTitle.value = '等额本金计算结果（含调整）'
    result.value = calculateEqualPrincipal(amount, rate, periods)
  } else {
    resultTitle.value = '等额本息计算结果（含调整）'
    result.value = calculateEqualPrincipalInterest(amount, rate, periods)
  }
  activeTab.value = 'monthly'
}

function reset() {
  loanAmount.value = 390000
  annualRate.value = 3.5
  loanPeriods.value = 180
  adjustments.value = [{ type: 'prepayment', period: null, prepaymentAmount: null, newRate: null }]
  result.value = null
  resultTitle.value = ''
  errorMsg.value = ''
  exportStatus.value = ''
  activeTab.value = 'monthly'
}

function addAdjustment() {
  adjustments.value.push({ type: 'prepayment', period: null, prepaymentAmount: null, newRate: null })
}

function removeAdjustment(index: number) {
  if (adjustments.value.length <= 1) {
    errorMsg.value = '至少需要保留一个调整项！'
    return
  }
  errorMsg.value = ''
  adjustments.value.splice(index, 1)
}

// ============================================================
// 导出 PDF
// ============================================================
async function exportPdf() {
  const data = result.value
  if (!data || exporting.value) return

  exporting.value = true
  exportStatus.value = ''
  try {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })

    // 嵌入黑体，保证中文正常显示
    const cnFont = await loadCnFont()
    if (cnFont) {
      doc.addFileToVFS('simhei.ttf', cnFont)
      doc.addFont('simhei.ttf', 'SimHei', 'normal')
      doc.setFont('SimHei')
    }

    const margin = 40
    const pageWidth = doc.internal.pageSize.getWidth()

    // 标题
    doc.setFontSize(16)
    doc.text(resultTitle.value.replace('结果', '报告'), margin, 44)
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text(
      `生成时间：${new Date().toLocaleString('zh-CN')}`,
      pageWidth - margin,
      44,
      { align: 'right' }
    )

    // 贷款信息与汇总
    doc.setTextColor(30)
    doc.setFontSize(11)
    doc.text(`贷款信息：${data.loanInfo}`, margin, 72)
    doc.setFontSize(10)
    doc.text(
      `总还款金额：${formatNumber(data.totalPayment)} 元    总利息：${formatNumber(data.totalInterest)} 元    首月还款：${formatNumber(data.firstMonthPayment)} 元`,
      margin,
      92
    )

    // 月度明细表
    autoTable(doc, {
      startY: 108,
      head: [['期数', '当月本金 (元)', '当月利息 (元)', '当月还款 (元)', '剩余本金 (元)']],
      body: data.monthlyDetails.map(d => [
        String(d.period),
        formatNumber(d.principal),
        formatNumber(d.interest),
        d.prepayment > 0
          ? `${formatNumber(d.payment)}+${formatNumber(d.prepayment)}(提前)`
          : formatNumber(d.payment),
        formatNumber(d.remaining)
      ]),
      styles: { font: 'SimHei', fontSize: 8, cellPadding: 3, halign: 'right' },
      headStyles: { fillColor: [64, 158, 255], textColor: 255, fontStyle: 'normal' },
      columnStyles: { 0: { halign: 'center' } },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      showHead: 'everyPage',
      didDrawCell: (cellData) => {
        const raw = cellData.cell.raw
        if (cellData.section === 'body' && cellData.column.index === 3 && typeof raw === 'string' && raw.includes('(提前)')) {
          cellData.cell.styles.fontStyle = 'bold'
        }
      }
    })

    // 按年汇总（新页）
    doc.addPage()
    doc.setFontSize(14)
    doc.setTextColor(30)
    doc.text('按年汇总', margin, 44)
    autoTable(doc, {
      startY: 56,
      head: [['年份', '当年还款总额 (元)']],
      body: data.yearlySummary.map(item => [String(item.year), formatNumber(item.amount)]),
      styles: { font: 'SimHei', fontSize: 9, cellPadding: 4, halign: 'right' },
      headStyles: { fillColor: [64, 158, 255], textColor: 255, fontStyle: 'normal' },
      columnStyles: { 0: { halign: 'center' } },
      alternateRowStyles: { fillColor: [245, 247, 250] }
    })

    // 保存
    const base64 = doc.output('datauristring').split(',')[1]
    const filePath = await window.electronAPI.dialog.saveFile({
      title: '导出房贷计算 PDF',
      defaultPath: `房贷计算报告-${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
    })
    if (!filePath) return

    const res = await window.electronAPI.file.writeBase64(filePath, base64)
    if (res.success) {
      exportStatus.value = 'success'
    } else {
      exportStatus.value = 'error'
      errorMsg.value = res.error || 'PDF 保存失败'
    }
  } catch (e: unknown) {
    exportStatus.value = 'error'
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    exporting.value = false
  }
}

const hasResult = computed(() => result.value !== null)
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>🏦 房贷计算器</h2>
      <p>支持等额本息 / 等额本金，可设置多组提前还款与利率调整</p>
    </div>

    <!-- 基础输入 -->
    <div class="form-section">
      <div class="field">
        <label>贷款金额（元）</label>
        <input v-model.number="loanAmount" class="input" type="number" min="1" placeholder="如 390000" />
      </div>
      <div class="field">
        <label>年利率（%）</label>
        <input v-model.number="annualRate" class="input" type="number" step="0.01" min="0" placeholder="如 3.5" />
      </div>
      <div class="field">
        <label>贷款期数（月）</label>
        <input v-model.number="loanPeriods" class="input" type="number" min="1" max="360" placeholder="如 180（15年×12）" />
      </div>
    </div>

    <!-- 还款调整设置 -->
    <div class="adjust-section">
      <div class="adjust-head">
        <span>还款调整设置（可选）</span>
        <button type="button" class="btn add" @click="addAdjustment">＋ 添加调整项</button>
      </div>
      <div v-for="(adj, index) in adjustments" :key="index" class="adjust-item">
        <div class="adjust-grid">
          <div class="field">
            <label>调整类型</label>
            <select v-model="adj.type" class="input select">
              <option value="prepayment">提前还款</option>
              <option value="rateChange">利率调整</option>
              <option value="both">提前还款+利率调整</option>
            </select>
          </div>
          <div class="field">
            <label>调整期数</label>
            <input v-model.number="adj.period" class="input" type="number" min="1" placeholder="如 98" />
          </div>
          <div v-if="adj.type !== 'rateChange'" class="field">
            <label>提前还款金额（元）</label>
            <input v-model.number="adj.prepaymentAmount" class="input" type="number" min="0" placeholder="如 20000" />
          </div>
          <div v-if="adj.type !== 'prepayment'" class="field">
            <label>调整后年利率（%）</label>
            <input v-model.number="adj.newRate" class="input" type="number" step="0.01" min="0" placeholder="如 3.1" />
          </div>
        </div>
        <button type="button" class="btn danger" @click="removeAdjustment(index)">删除</button>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="btn-group">
      <button type="button" class="btn primary" @click="calc('equalPrincipalInterest')">计算等额本息</button>
      <button type="button" class="btn primary" @click="calc('equalPrincipal')">计算等额本金</button>
      <button type="button" class="btn" @click="exportPdf" :disabled="!hasResult || exporting">
        {{ exporting ? '导出中…' : '导出 PDF' }}
      </button>
      <button type="button" class="btn ghost" @click="reset">重置</button>
    </div>

    <div v-if="errorMsg" class="error">⚠️ {{ errorMsg }}</div>
    <div v-if="exportStatus === 'success'" class="desc">✅ PDF 已导出</div>

    <!-- 结果展示 -->
    <div v-if="result" class="result-section">
      <div class="result-header">
        <h3>{{ resultTitle }}</h3>
        <span class="loan-info">{{ result.loanInfo }}</span>
      </div>

      <div class="summary">
        <div class="summary-item">
          <div class="summary-value">{{ formatNumber(result.totalPayment) }}</div>
          <div class="summary-label">总还款金额（元）</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">{{ formatNumber(result.totalInterest) }}</div>
          <div class="summary-label">总利息（元）</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">{{ formatNumber(result.firstMonthPayment) }}</div>
          <div class="summary-label">首月还款金额（元）</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">{{ result.monthlyDetails.length }}</div>
          <div class="summary-label">实际还款期数</div>
        </div>
      </div>

      <div class="tabs">
        <div class="tab" :class="{ active: activeTab === 'monthly' }" @click="activeTab = 'monthly'">按月明细</div>
        <div class="tab" :class="{ active: activeTab === 'yearly' }" @click="activeTab = 'yearly'">按年汇总</div>
      </div>

      <table v-if="activeTab === 'monthly'" class="detail-table">
        <thead>
          <tr>
            <th>期数</th>
            <th>当月本金 (元)</th>
            <th>当月利息 (元)</th>
            <th>当月还款 (元)</th>
            <th>剩余本金 (元)</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in result.monthlyDetails"
            :key="item.period"
            :class="{ highlight: item.prepayment > 0 || item.rateChanged }"
          >
            <td>{{ item.period }}</td>
            <td>{{ formatNumber(item.principal) }}</td>
            <td>{{ formatNumber(item.interest) }}</td>
            <td>
              {{ formatNumber(item.payment) }}
              <span v-if="item.prepayment > 0" class="tag-prepay">+{{ formatNumber(item.prepayment) }}(提前)</span>
            </td>
            <td>{{ formatNumber(item.remaining) }}</td>
          </tr>
        </tbody>
      </table>

      <table v-else class="detail-table">
        <thead>
          <tr>
            <th>年份</th>
            <th>当年还款总额 (元)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in result.yearlySummary" :key="item.year">
            <td>{{ item.year }}</td>
            <td>{{ formatNumber(item.amount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.tool-card {
  height: 100%;
  overflow: auto;
  background: #fff;
  border-radius: 8px;
  padding: 16px 18px 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.head h2 { margin: 0 0 4px; font-size: 18px; color: #303133; }
.head p { margin: 0 0 14px; font-size: 13px; color: #909399; }

/* ============ 输入区 ============ */
.form-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
  padding: 16px;
  background: #f9f9f9;
  border-radius: 8px;
}
.field > label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}
.input {
  width: 100%;
  height: 36px;
  box-sizing: border-box;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 12px;
  font-size: 14px;
  font-family: Consolas, monospace;
}
.input:focus { outline: none; border-color: #409eff; }
.input.select {
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 16px;
  padding-right: 35px;
  cursor: pointer;
  font-family: "Microsoft YaHei", sans-serif;
}

/* ============ 调整项 ============ */
.adjust-section {
  margin-bottom: 16px;
  padding: 16px;
  background: #f9f9f9;
  border-radius: 8px;
}
.adjust-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.adjust-item {
  position: relative;
  margin-bottom: 14px;
  padding: 14px;
  border: 1px dashed #ddd;
  border-radius: 6px;
  background: #fff;
}
.adjust-item:last-child { margin-bottom: 0; }
.adjust-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
  margin-bottom: 10px;
}

/* ============ 按钮 ============ */
.btn-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.btn {
  height: 34px;
  padding: 0 18px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn:hover:not(:disabled) { border-color: #409eff; color: #409eff; }
.btn.primary { background: #409eff; border-color: #409eff; color: #fff; }
.btn.primary:hover { background: #337ecc; border-color: #337ecc; color: #fff; }
.btn.add { height: 28px; padding: 0 12px; font-size: 12px; background: #67c23a; border-color: #67c23a; color: #fff; }
.btn.add:hover { background: #529b2e; border-color: #529b2e; color: #fff; }
.btn.danger { height: 28px; padding: 0 12px; font-size: 12px; background: #f56c6c; border-color: #f56c6c; color: #fff; }
.btn.danger:hover { background: #e05050; border-color: #e05050; color: #fff; }
.btn.ghost { color: #909399; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ============ 提示 ============ */
.error {
  margin-bottom: 12px;
  padding: 8px 10px;
  background: #fef0f0;
  color: #f56c6c;
  border-radius: 6px;
  font-size: 13px;
}
.desc { margin-bottom: 12px; font-size: 13px; color: #67c23a; }

/* ============ 结果区 ============ */
.result-section { margin-top: 8px; }
.result-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
}
.result-header h3 { margin: 0; font-size: 16px; color: #303133; }
.loan-info { font-size: 12px; color: #909399; font-family: Consolas, monospace; }

.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
  padding: 16px;
  background: #f0f8ff;
  border-radius: 8px;
}
.summary-item { text-align: center; }
.summary-value {
  font-size: 22px;
  font-weight: 700;
  color: #409eff;
  margin: 4px 0;
  font-family: Consolas, monospace;
}
.summary-label { color: #666; font-size: 13px; }

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.tab {
  padding: 7px 16px;
  background: #f0f0f0;
  border-radius: 6px;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
  transition: all 0.2s;
}
.tab:hover { background: #e4e4e4; }
.tab.active { background: #409eff; color: #fff; }

.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.detail-table th,
.detail-table td {
  padding: 8px 10px;
  text-align: center;
  border: 1px solid #eee;
  white-space: nowrap;
}
.detail-table thead th {
  position: sticky;
  top: 0;
  background: #f5f5f5;
  font-weight: 600;
  color: #333;
  z-index: 1;
}
.detail-table tbody tr:nth-child(even) { background: #f9f9f9; }
.detail-table tbody tr.highlight { background: #fff3cd; }
.tag-prepay { color: #e6a23c; font-size: 12px; }
</style>
