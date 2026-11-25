"""Generate per-class image-level recall from held-out predictions."""
import argparse
import csv
from collections import Counter

CLASSES = ("akiec", "bcc", "bkl", "df", "mel", "nv", "vasc")


def summarize(path):
    support = Counter()
    correct = Counter()
    image_ids = set()
    with open(path, newline="", encoding="utf-8-sig") as source:
        rows = csv.DictReader(source)
        if not {"image_id", "y_true", "y_pred"}.issubset(rows.fieldnames or []):
            raise ValueError("Expected image_id, y_true, and y_pred columns")
        for line, row in enumerate(rows, start=2):
            image_id = (row["image_id"] or "").strip()
            truth = (row["y_true"] or "").strip()
            prediction = (row["y_pred"] or "").strip()
            if not image_id or image_id in image_ids:
                raise ValueError(f"Missing or duplicate image ID on line {line}")
            if truth not in CLASSES or prediction not in CLASSES:
                raise ValueError(f"Unknown class on line {line}")
            image_ids.add(image_id)
            support[truth] += 1
            correct[truth] += truth == prediction
    if not image_ids:
        raise ValueError("Prediction CSV is empty")
    return support, correct


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("predictions")
    args = parser.parse_args()
    try:
        support, correct = summarize(args.predictions)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(f"Test images: {sum(support.values())}\n")
    print("| Class | Recall | Test support | Correct | Missed |")
    print("| --- | --- | --- | --- | --- |")
    for label in CLASSES:
        count = support[label]
        hits = correct[label]
        recall = f"{hits / count:.2%}" if count else "undefined"
        display = "**mel (melanoma)**" if label == "mel" else label
        print(f"| {display} | {recall} | {count} | {hits} | {count - hits} |")


if __name__ == "__main__":
    main()
