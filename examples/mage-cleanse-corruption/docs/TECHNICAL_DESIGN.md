# Mage: Cleanse the Corruption — Technical Design

## Verified environment

- Runtime: browser JavaScript
- Target: desktop browser, дальнейшая адаптация под Yandex Games
- Prototype delivery: static site

## Architecture direction

Отделить чистое состояние игры от DOM-представления:

- `GameState` — деньги, базовый урон, выбранная стихия, серия/участок;
- `EnemyState` — имя, уровень, стихия, max HP, current HP, награда и состояние alive/dying;
- команды `selectElement`, `attack`, `buyDamage`, `spawnNextEnemy`;
- один render-проход обновляет UI после изменения состояния;
- анимационные эффекты не являются источником игрового состояния.

## Runtime flow

Загрузка создаёт `GameState` и первого врага. Атака рассчитывает модификатор стихии, один раз меняет HP и запускает feedback. Переход в `dying` блокирует новые атаки; награда начисляется один раз. После задержки создаётся следующий враг и UI возвращается в состояние боя.

## Persistence

Для M0 сохранение не требуется. Перед публикацией допускается версия данных в `localStorage`; повреждённые или устаревшие данные должны безопасно сбрасываться.

## Performance constraints

- Один `requestAnimationFrame`-цикл только при необходимости анимации.
- Удаление завершённых damage popups и монет из DOM.
- Отсутствие растущих списков таймеров и слушателей.
- Рабочий viewport от 1280×720; mobile проверяется в следующем milestone.

## Risks and spikes

- Проверить, сохраняется ли читаемость при одновременном damage popup и выпадении нескольких монет.
- До интеграции изучить актуальные требования SDK выбранной игровой платформы.

## Verification commands

После появления исходников зафиксировать команды локального запуска, production build и проверки консоли браузера. M0 требует ручной сценарий из `QA.md`.
