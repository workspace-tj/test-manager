---
id: tax-rounding
kind: feature
title: 消費税の端数処理
parent: billing
---

消費税は請求書ごと、税率ごとに計算し、1円未満を切り捨てます（インボイス制度の要件）。

```
税額 = floor(税率ごとの税抜合計 × 税率)
```
