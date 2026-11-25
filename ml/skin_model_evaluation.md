# ANVAYA skin model evaluation

**Held-out test results are pending.** The remote repository does not contain the selected checkpoint and original test artifacts. Validation metrics and results from the API fallback estimator cannot fill this table.

| Class | Recall | Test support | Correct | Missed |
| --- | --- | --- | --- | --- |
| akiec | Pending | Pending | Pending | Pending |
| bcc | Pending | Pending | Pending | Pending |
| bkl | Pending | Pending | Pending | Pending |
| df | Pending | Pending | Pending | Pending |
| **mel (melanoma)** | **Pending** | **Pending** | **Pending** | **Pending** |
| nv | Pending | Pending | Pending | Pending |
| vasc | Pending | Pending | Pending | Pending |

Use the original held-out split, confirm that its lesion IDs do not overlap training or validation, and run the selected checkpoint with its recorded evaluation preprocessing and class ordering. Export one row per test image to a local CSV with columns `image_id,y_true,y_pred`, keeping IDs unique across the file. Use the seven class codes above. Record the checkpoint identifier, preprocessing, and split provenance alongside the generated table. Confirm that the CSV row count matches the original test split.

```powershell
python ml/skin_recall.py path/to/held_out_predictions.csv
```

Recall is correct predictions divided by true test examples for a class. Missed melanoma cases are all rows where `y_true` is `mel` and `y_pred` is another class. These are image-level counts. The report shows an undefined recall when a class has zero examples.
