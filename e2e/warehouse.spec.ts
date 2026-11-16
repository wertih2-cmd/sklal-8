import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Склад (этап 4). Только для ТЕСТОВОЙ базы (docs/test-database.md): тесты создают категорию, товар,
// документ прихода и инвентаризацию склада. Рабочая база не подходит.
// Часть 1 проверяет серверные правила через RPC (по ним нет зависимости от вёрстки).
// Часть 2 проверяет экраны ошибок этапа 3: сбой запроса warehouse_stock имитируется через page.route.

const ALLOWED = process.env.E2E_ALLOW === '1'
const SUPA_URL = process.env.E2E_SUPABASE_URL!
const SUPA_ANON = process.env.E2E_SUPABASE_ANON_KEY!
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN!
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD!

test.skip(!ALLOWED, 'E2E_ALLOW=1 required')

const STAMP = Date.now()
const ITEM_NAME = `E2E WH ${STAMP}`

async function adminClient(): Promise<SupabaseClient> {
  const c = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } })
  const email = `${ADMIN_LOGIN.toLowerCase().trim()}@sklad.internal`
  const { error } = await c.auth.signInWithPassword({ email, password: ADMIN_PW })
  if (error) throw error
  return c
}

async function login(page: Page, loginName: string, password: string) {
  await page.goto('/')
  await page.getByTestId('login-form').waitFor()
  await page.fill('input[name="username"]', loginName)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/admin', { timeout: 15000 })
}

async function warehouseQty(c: SupabaseClient, itemId: number): Promise<number> {
  const { data, error } = await c.from('warehouse_stock').select('qty').eq('item_id', itemId).maybeSingle()
  if (error) throw error
  return Number(data?.qty ?? 0)
}

function receipt(c: SupabaseClient, lines: unknown[]) {
  return c.rpc('post_document', {
    p_op: 'receipt',
    p_lines: lines,
    p_apartment: null,
    p_staff: null,
    p_supplier: null,
    p_note: 'e2e warehouse',
  })
}

test.describe('Склад: серверные правила (RPC)', () => {
  test.describe.configure({ mode: 'serial' })

  let admin: SupabaseClient
  let itemId = 0
  let inventoryId: string | null = null

  test.beforeAll(async () => {
    admin = await adminClient()
    const cat = await admin
      .from('categories')
      .insert({ name: `E2E WH cat ${STAMP}`, kind: 'consumable', sort: 0 })
      .select('id')
      .single()
    if (cat.error) throw cat.error
    const item = await admin
      .from('items')
      .insert({ category_id: cat.data.id, name: ITEM_NAME, sort: 0, active: true })
      .select('id')
      .single()
    if (item.error) throw item.error
    itemId = item.data.id as number
  })

  test.afterAll(async () => {
    if (!admin) return
    if (inventoryId) await admin.rpc('inventory_cancel', { p_inventory: inventoryId })
    if (itemId) await admin.from('items').update({ active: false }).eq('id', itemId)
  })

  test('приход увеличивает остаток склада', async () => {
    const { error } = await receipt(admin, [{ item_id: itemId, qty: 10, unit_cost: 5 }])
    expect(error).toBeNull()
    expect(await warehouseQty(admin, itemId)).toBe(10)
  })

  test('некорректные строки документа отклоняются без изменения остатка', async () => {
    const bad: Array<{ name: string; lines: unknown[] }> = [
      { name: 'qty = 0', lines: [{ item_id: itemId, qty: 0, unit_cost: 5 }] },
      { name: 'qty < 0', lines: [{ item_id: itemId, qty: -3, unit_cost: 5 }] },
      { name: 'отрицательная стоимость', lines: [{ item_id: itemId, qty: 1, unit_cost: -1 }] },
      {
        name: '+10 и -8 по одному товару не сворачиваются в +2',
        lines: [
          { item_id: itemId, qty: 10, unit_cost: 5 },
          { item_id: itemId, qty: -8, unit_cost: 5 },
        ],
      },
      { name: 'пустой массив', lines: [] },
    ]
    for (const b of bad) {
      const { error } = await receipt(admin, b.lines)
      expect(error, b.name).not.toBeNull()
      expect(await warehouseQty(admin, itemId), `остаток после «${b.name}»`).toBe(10)
    }
  })

  test('инвентаризация: закрытие без пересчёта запрещено, пересчёт корректирует остаток', async () => {
    const start = await admin.rpc('inventory_start', { p_scope: 'warehouse', p_apartment: null, p_note: 'e2e' })
    if (start.error && /уже открыта/i.test(start.error.message)) {
      test.skip(true, 'на тестовой базе уже есть открытая инвентаризация склада')
      return
    }
    expect(start.error).toBeNull()
    inventoryId = start.data as string

    // Закрытие без пересчёта: ошибка, остаток не тронут.
    const early = await admin.rpc('inventory_close', { p_inventory: inventoryId, p_reject_items: [] })
    expect(early.error).not.toBeNull()
    expect(early.error?.message).toMatch(/Не пересчитано/)
    expect(await warehouseQty(admin, itemId)).toBe(10)

    // Остальные позиции (если есть) подтверждаем «как по учёту», наш товар считаем как 7.
    const lines = await admin.from('inventory_lines').select('item_id,expected').eq('inventory_id', inventoryId)
    expect(lines.error).toBeNull()
    const payload = (lines.data ?? []).map((l) => ({
      item_id: l.item_id as number,
      actual: l.item_id === itemId ? 7 : Number(l.expected),
    }))
    expect(payload.some((l) => l.item_id === itemId)).toBe(true)
    const bulk = await admin.rpc('inventory_set_actual_bulk', { p_inventory: inventoryId, p_lines: payload })
    expect(bulk.error).toBeNull()

    const close = await admin.rpc('inventory_close', { p_inventory: inventoryId, p_reject_items: [] })
    expect(close.error).toBeNull()
    expect((close.data as { adjusted?: number }).adjusted).toBe(1)
    inventoryId = null
    expect(await warehouseQty(admin, itemId)).toBe(7)
  })

  test('отрицательный факт в bulk отклоняется целиком', async () => {
    const start = await admin.rpc('inventory_start', { p_scope: 'warehouse', p_apartment: null, p_note: 'e2e neg' })
    if (start.error && /уже открыта/i.test(start.error.message)) {
      test.skip(true, 'на тестовой базе уже есть открытая инвентаризация склада')
      return
    }
    expect(start.error).toBeNull()
    inventoryId = start.data as string

    const res = await admin.rpc('inventory_set_actual_bulk', {
      p_inventory: inventoryId,
      p_lines: [{ item_id: itemId, actual: -1 }],
    })
    expect(res.error).not.toBeNull()

    const line = await admin
      .from('inventory_lines')
      .select('counted')
      .eq('inventory_id', inventoryId)
      .eq('item_id', itemId)
      .maybeSingle()
    expect(line.error).toBeNull()
    expect(line.data?.counted).toBe(false)

    const cancel = await admin.rpc('inventory_cancel', { p_inventory: inventoryId })
    expect(cancel.error).toBeNull()
    inventoryId = null
  })
})

test.describe('Склад: экраны ошибок загрузки (этап 3)', () => {
  const STOCK_URL = '**/rest/v1/warehouse_stock*'

  test('склад компании: сбой загрузки даёт экран ошибки и «Повторить»', async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await page.route(STOCK_URL, (route) => route.abort())
    await page.goto('/admin/stock')
    await expect(page.getByText('Не удалось загрузить данные')).toBeVisible({ timeout: 15000 })
    const retry = page.getByRole('button', { name: 'Повторить' })
    await expect(retry).toBeVisible()

    await page.unroute(STOCK_URL)
    await retry.click()
    await expect(page.getByText('Не удалось загрузить данные')).toBeHidden({ timeout: 15000 })
  })

  test('склад owner: сбой warehouse_stock не превращает товары в расходники', async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await page.route(STOCK_URL, (route) => route.abort())
    await page.goto('/admin/stock?tab=owner')
    await expect(page.getByText('Не удалось загрузить данные')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible()
  })

  test('инвентаризация: сбой загрузки склада даёт «Повторить» вместо поля добавления', async ({ page }) => {
    const admin = await adminClient()
    const start = await admin.rpc('inventory_start', { p_scope: 'warehouse', p_apartment: null, p_note: 'e2e ui' })
    if (start.error) {
      test.skip(true, `не удалось открыть инвентаризацию склада: ${start.error.message}`)
      return
    }
    const invId = start.data as string
    try {
      await login(page, ADMIN_LOGIN, ADMIN_PW)
      await page.goto('/admin/more/inventory')
      await page.route(STOCK_URL, (route) => route.abort())
      // Строка списка (не чип фильтра «Открыта»): ищем по уникальному примечанию.
      await page.locator('div.space-y-2 > button').filter({ hasText: 'e2e ui' }).first().click()
      await expect(page.getByText('Не удалось загрузить данные')).toBeVisible({ timeout: 15000 })
      await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible()
      await expect(page.getByText('Добавить позицию, которой нет в списке')).toHaveCount(0)
    } finally {
      await admin.rpc('inventory_cancel', { p_inventory: invId })
    }
  })
})
