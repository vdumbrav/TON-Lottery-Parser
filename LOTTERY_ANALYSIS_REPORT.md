# TON Lottery Parser - Отчёт

## Контракт

**Адрес**: `EQCHbnxDzu6b7U25pLV2V1cWwh1IxxtHPKmZky4Wpo-m-WuM`

**Tonviewer**: https://tonviewer.com/EQCHbnxDzu6b7U25pLV2V1cWwh1IxxtHPKmZky4Wpo-m-WuM

---

## Результаты парсинга

| Метрика | Значение |
|---------|----------|
| Всего лотерейных билетов | **9024** |
| Уникальных транзакций | **9024** |
| Цена билета | **1 TON** |
| Реферальная ставка | **10%** (0.1 TON) |

---

## Статистика выигрышей

| Приз | Количество | % от выигрышей |
|------|------------|----------------|
| x1 | 887 | 69.7% |
| x3 | 229 | 18.0% |
| x7 | 101 | 7.9% |
| x20 | 49 | 3.8% |
| x77 | 7 | 0.5% |
| x200 | 0 | 0% |
| jackpot | 0 | 0% |

**Всего выигрышей**: 1273 из 9024 (14.1%)

---

## Топ-10 рефералов

| # | Адрес | Приглашений | Заработано TON |
|---|-------|-------------|----------------|
| 1 | `UQAfSJQDMiMKvuPfIE-xzJdflIehLjnyVnYckR-S6m__Z3Sm` | 916 | 91.6 |
| 2 | `UQAxLrgwh87V7iz9T152ZY0CVUAojlBaEKtRoIqzoznr3cAD` | 867 | 86.7 |
| 3 | `UQClIBCGu6FTjZku5CanNKCM1dJhL67sr7QKMhXBrQvuADPv` | 570 | 57.0 |
| 4 | `UQDjIzjcnHMQr3g2KLYTctAZZTJBJCVJRnZTTyrRXRJzKI80` | 389 | 38.9 |
| 5 | `UQCqGDztHXWCny3lKZlr4q9k3ZqMAtq1O2074Buv9rm_PFrr` | 368 | 36.8 |
| 6 | `UQDoz9cHQFAG88bC4jBC7LpXpUZZFN5J9IBBe-atmen3-auE` | 264 | 26.4 |
| 7 | `UQCXe51N9aeK2BSe8-URcmhtJhKRotN8OGaiE4LL1FuqnwNn` | 239 | 23.9 |
| 8 | `UQBpZGp55xrezubdsUwuhLFvyqy6gldeo-h22OkDk006e1CL` | 232 | 23.2 |
| 9 | `UQC1Bcsd6QtVa-NUKWymA4Dcvl9x_4pJemZQHm0y_bm0RcnE` | 224 | 22.4 |
| 10 | `UQA_ZrZ_EmbUq2fsCdcz9fL7YbYLbS62DkucDlm5mTrPDRqO` | 206 | 20.6 |

---

## Технические детали

### API провайдер

**tonapi.io** (ранее toncenter.com)

- Endpoint: `/v2/blockchain/accounts/{account}/transactions`
- Rate limit: 1 req/s
- API key: https://tonconsole.com/tonapi/api-keys

### Opcodes лотереи

```typescript
OP_PRIZ  = 0x5052495a  // Выплата приза
OP_REFF  = 0x52454646  // Реферальный платёж
OP_DEPLOY = 0x801b4fb4 // Деплой NFT
```

### Валидация транзакций

Транзакция считается лотерейным билетом если:
1. `buyAmount === ticketPrice` (цена из контракта)
2. Транзакция направлена К контракту
3. Есть валидный адрес участника

### Получение цены билета

Цена билета получается динамически из контракта:
- API: toncenter `/api/v3/runGetMethod`
- Метод: `get_full_data`
- Индекс: 4 (для TON контрактов)

---

## Структура проекта

```
src/
├── config/config.ts         # Конфигурация
├── constants/lottery.ts     # Константы (PRIZE_MAP, opcodes)
├── core/
│   ├── processor.ts         # Обработка
│   ├── utils.ts             # Утилиты
│   └── validator.ts         # Валидатор
├── services/
│   ├── apiServiceTon.ts     # TON API сервис
│   ├── apiServiceJetton.ts  # Jetton API сервис
│   ├── csvService.ts        # CSV операции
│   └── stateService.ts      # Хранение состояния
├── types/
│   ├── index.ts             # Основные типы
│   └── tonApi.ts            # Типы TonAPI
└── index.ts                 # Точка входа
```

---

## Конфигурация (.env)

```dotenv
TONAPI_URL=https://tonapi.io
TONAPI_KEY=your_api_key
TON_CONTRACT_ADDRESS=EQCHbnxDzu6b7U25pLV2V1cWwh1IxxtHPKmZky4Wpo-m-WuM
CONTRACT_TYPE=TON
PAGE_LIMIT=100
```

---

## Запуск

```bash
# Установка
npm install

# Запуск парсера
npm start

# Анализ данных
npm run analyze
```

---

**Дата обновления**: 27 ноября 2025
