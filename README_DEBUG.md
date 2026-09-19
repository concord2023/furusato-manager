# デバッグ方針
- Google Drive検索はファイル名 `1219856`、対象年＋前年だけに限定。
- PDF.jsは元ArrayBufferを直接渡さず、コピーしたBlob URLから開く。OCRは同じPDF.jsドキュメントを使い、再度ArrayBufferを開かない。
- 給与明細はOCRを必須条件にしない。支給合計−非課税額で課税対象額を復元できる場合はOCRを実行せず登録する。
- OCRは最後のフォールバックであり、iOSのOCRランタイムエラーで給与登録そのものを失敗させない。
- `furusatoState` が主データ。`furusatoPayrollStore` は復旧用コピーであり、空の古いストアで主データを上書きしない。
- Service Workerキャッシュはv9。
