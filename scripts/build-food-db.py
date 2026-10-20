"""
Builds the offline food database from USDA FoodData Central "SR Legacy" (public domain / CC0).

  1. Download: https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
  2. Unzip, then run:  python3 -I scripts/build-food-db.py <path-to-unzipped-folder>

Output: src/data/foods/usda-sr-legacy.json, compact rows (all nutrient values per 100 g):
  [fdcId, name, categoryIndex, kcal, proteinG, fatG, carbsG, fiberG|null, sodiumMg|null, [[portionLabel, grams], ...]]
Values are copied from USDA as published; nothing is estimated here.
"""
import csv
import json
import os
import sys

NUTRIENTS = {"1008": "kcal", "1003": "protein", "1004": "fat", "1005": "carbs", "1079": "fiber", "1093": "sodium"}
MAX_PORTIONS = 6


def read(folder, name):
    with open(os.path.join(folder, name + ".csv"), newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def r1(v):
    return None if v is None else round(float(v), 1)


def main(folder, out_path):
    categories = {row["id"]: row["description"] for row in read(folder, "food_category")}
    units = {row["id"]: row["name"] for row in read(folder, "measure_unit")}
    foods = {row["fdc_id"]: row for row in read(folder, "food")}

    values = {}
    for row in read(folder, "food_nutrient"):
        key = NUTRIENTS.get(row["nutrient_id"])
        if key and row["amount"] != "":
            values.setdefault(row["fdc_id"], {})[key] = float(row["amount"])

    portions = {}
    for row in read(folder, "food_portion"):
        grams = row["gram_weight"]
        if not grams or float(grams) <= 0:
            continue
        amount = row["amount"] or "1"
        amount = amount[:-2] if amount.endswith(".0") else amount
        unit = units.get(row["measure_unit_id"], "")
        parts = [amount]
        if unit and unit != "undetermined":
            parts.append(unit)
        desc = ", ".join(x for x in [row["modifier"].strip(), row["portion_description"].strip()] if x)
        label = " ".join(parts) + ((" " if unit == "undetermined" or not unit else ", ") + desc if desc else "")
        portions.setdefault(row["fdc_id"], []).append((int(row["seq_num"] or 0), label.strip(), round(float(grams), 1)))

    cat_names = sorted(set(categories.values()))
    cat_index = {c: i for i, c in enumerate(cat_names)}
    rows = []
    skipped = 0
    for fdc_id, food in foods.items():
        v = values.get(fdc_id, {})
        if any(k not in v for k in ("kcal", "protein", "fat", "carbs")):
            skipped += 1
            continue
        ps = sorted(portions.get(fdc_id, []))[:MAX_PORTIONS]
        rows.append([
            int(fdc_id), food["description"], cat_index[categories[food["food_category_id"]]],
            r1(v["kcal"]), r1(v["protein"]), r1(v["fat"]), r1(v["carbs"]), r1(v.get("fiber")), r1(v.get("sodium")),
            [[label, g] for _, label, g in ps],
        ])
    rows.sort(key=lambda r: r[1].lower())
    out = {
        "source": "USDA FoodData Central, SR Legacy (April 2018)",
        "license": "Public domain (CC0 1.0). U.S. Department of Agriculture, Agricultural Research Service.",
        "url": "https://fdc.nal.usda.gov/",
        "per": "100 g",
        "categories": cat_names,
        "foods": rows,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(rows)} foods written, {skipped} skipped (missing energy/macros), {os.path.getsize(out_path) // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: build-food-db.py <unzipped-sr-legacy-folder> [out.json]")
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "src/data/foods/usda-sr-legacy.json")
