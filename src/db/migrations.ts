import { EXERCISES } from '../motion/exercises';
import { Db } from './types';

/**
 * Append-only list of schema migrations. Never edit a shipped migration; add a new one.
 * Internal units: kg, cm, meters, seconds, kcal. `local_date` = YYYY-MM-DD in the user's calendar.
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE user_profile (
  id TEXT PRIMARY KEY CHECK (id = 'me'),
  display_name TEXT,
  birth_year INTEGER CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
  sex TEXT CHECK (sex IS NULL OR sex IN ('female','male')),
  height_cm REAL CHECK (height_cm IS NULL OR height_cm BETWEEN 50 AND 260),
  activity_level TEXT CHECK (activity_level IS NULL OR activity_level IN ('sedentary','light','moderate','active','very_active')),
  experience TEXT CHECK (experience IS NULL OR experience IN ('beginner','intermediate','advanced')),
  unit_system TEXT NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric','imperial')),
  dietary_preferences TEXT,
  onboarded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fitness_goals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('cut','strength','endurance','swim','general')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  start_weight_kg REAL CHECK (start_weight_kg IS NULL OR start_weight_kg BETWEEN 20 AND 400),
  target_weight_kg REAL CHECK (target_weight_kg IS NULL OR target_weight_kg BETWEEN 20 AND 400),
  target_date TEXT,
  daily_calorie_target_kcal REAL CHECK (daily_calorie_target_kcal IS NULL OR daily_calorie_target_kcal BETWEEN 500 AND 10000),
  daily_protein_target_g REAL CHECK (daily_protein_target_g IS NULL OR daily_protein_target_g BETWEEN 0 AND 600),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE UNIQUE INDEX one_primary_goal ON fitness_goals(is_primary) WHERE is_primary = 1 AND archived_at IS NULL;

CREATE TABLE exercises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  camera_supported INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE exercise_variations (
  id TEXT PRIMARY KEY,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE exercise_analysis_configs (
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  PRIMARY KEY (exercise_id, version)
);

CREATE TABLE workout_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workout_plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  substitution_exercise_id TEXT REFERENCES exercises(id),
  position INTEGER NOT NULL,
  target_sets INTEGER NOT NULL CHECK (target_sets BETWEEN 1 AND 20),
  target_reps INTEGER NOT NULL CHECK (target_reps BETWEEN 1 AND 200),
  rest_sec INTEGER NOT NULL CHECK (rest_sec BETWEEN 0 AND 900),
  UNIQUE (plan_id, position)
);

CREATE TABLE workout_sessions (
  id TEXT PRIMARY KEY,
  plan_id TEXT REFERENCES workout_plans(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paused','completed','abandoned')),
  local_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  active_duration_sec INTEGER NOT NULL DEFAULT 0,
  rpe INTEGER CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX workout_sessions_date ON workout_sessions(local_date);
CREATE INDEX workout_sessions_status ON workout_sessions(status);

CREATE TABLE workout_exercises (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL,
  target_sets INTEGER NOT NULL CHECK (target_sets BETWEEN 1 AND 20),
  target_reps INTEGER NOT NULL CHECK (target_reps BETWEEN 1 AND 200),
  rest_sec INTEGER NOT NULL CHECK (rest_sec BETWEEN 0 AND 900),
  UNIQUE (session_id, position)
);

CREATE TABLE exercise_sets (
  id TEXT PRIMARY KEY,
  workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_index INTEGER NOT NULL,
  target_reps INTEGER,
  completed_reps INTEGER NOT NULL CHECK (completed_reps >= 0),
  partial_reps INTEGER NOT NULL DEFAULT 0 CHECK (partial_reps >= 0),
  source TEXT NOT NULL CHECK (source IN ('camera','manual')),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  rest_sec INTEGER,
  UNIQUE (workout_exercise_id, set_index)
);

CREATE TABLE motion_session_summaries (
  set_id TEXT PRIMARY KEY REFERENCES exercise_sets(id) ON DELETE CASCADE,
  analyzer_version INTEGER NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE pose_sequence_refs (
  set_id TEXT PRIMARY KEY REFERENCES exercise_sets(id) ON DELETE CASCADE,
  file_uri TEXT NOT NULL,
  frame_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX pose_sequence_refs_expiry ON pose_sequence_refs(expires_at);

CREATE TABLE body_weight_entries (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  weight_kg REAL NOT NULL CHECK (weight_kg BETWEEN 20 AND 400),
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX body_weight_date ON body_weight_entries(local_date);

CREATE TABLE body_measurements (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('waist','body_fat')),
  value REAL NOT NULL CHECK (value > 0),
  unit TEXT NOT NULL CHECK (unit IN ('cm','percent')),
  method TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'waist' AND unit = 'cm') OR (kind = 'body_fat' AND unit = 'percent' AND value < 75))
);
CREATE INDEX body_measurements_date ON body_measurements(kind, local_date);

CREATE TABLE food_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  serving_qty REAL NOT NULL CHECK (serving_qty > 0),
  serving_unit TEXT NOT NULL,
  kcal REAL NOT NULL CHECK (kcal >= 0),
  protein_g REAL NOT NULL CHECK (protein_g >= 0),
  carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
  fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0),
  fiber_g REAL CHECK (fiber_g IS NULL OR fiber_g >= 0),
  sodium_mg REAL CHECK (sodium_mg IS NULL OR sodium_mg >= 0),
  source TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Entries snapshot their nutrition values so editing a saved food never rewrites history.
CREATE TABLE nutrition_entries (
  id TEXT PRIMARY KEY,
  food_item_id TEXT REFERENCES food_items(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast','lunch','dinner','snack')),
  local_date TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  servings REAL NOT NULL CHECK (servings > 0),
  serving_qty REAL,
  serving_unit TEXT,
  kcal REAL NOT NULL CHECK (kcal >= 0),
  protein_g REAL NOT NULL CHECK (protein_g >= 0),
  carbs_g REAL,
  fat_g REAL,
  fiber_g REAL,
  sodium_mg REAL,
  source TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX nutrition_entries_date ON nutrition_entries(local_date);

CREATE TABLE running_activities (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  started_at TEXT,
  distance_m REAL NOT NULL CHECK (distance_m > 0 AND distance_m <= 1000000),
  duration_sec INTEGER NOT NULL CHECK (duration_sec > 0 AND duration_sec <= 604800),
  kind TEXT NOT NULL CHECK (kind IN ('outdoor','treadmill','trail')),
  avg_hr INTEGER CHECK (avg_hr IS NULL OR avg_hr BETWEEN 30 AND 250),
  max_hr INTEGER CHECK (max_hr IS NULL OR max_hr BETWEEN 30 AND 250),
  cadence_spm INTEGER CHECK (cadence_spm IS NULL OR cadence_spm BETWEEN 60 AND 260),
  elevation_gain_m REAL CHECK (elevation_gain_m IS NULL OR elevation_gain_m >= 0),
  rpe INTEGER CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX running_date ON running_activities(local_date);

CREATE TABLE running_splits (
  activity_id TEXT NOT NULL REFERENCES running_activities(id) ON DELETE CASCADE,
  split_index INTEGER NOT NULL,
  distance_m REAL NOT NULL CHECK (distance_m > 0),
  duration_sec INTEGER NOT NULL CHECK (duration_sec > 0),
  PRIMARY KEY (activity_id, split_index)
);

CREATE TABLE swimming_activities (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  started_at TEXT,
  distance_m REAL NOT NULL CHECK (distance_m > 0 AND distance_m <= 100000),
  duration_sec INTEGER NOT NULL CHECK (duration_sec > 0 AND duration_sec <= 172800),
  environment TEXT NOT NULL CHECK (environment IN ('pool','open_water')),
  pool_length_m REAL CHECK (pool_length_m IS NULL OR pool_length_m BETWEEN 10 AND 100),
  pool_length_unit TEXT CHECK (pool_length_unit IS NULL OR pool_length_unit IN ('m','yd')),
  laps INTEGER CHECK (laps IS NULL OR laps > 0),
  stroke TEXT CHECK (stroke IS NULL OR stroke IN ('freestyle','breaststroke','backstroke','butterfly','mixed')),
  avg_hr INTEGER CHECK (avg_hr IS NULL OR avg_hr BETWEEN 30 AND 250),
  rpe INTEGER CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX swimming_date ON swimming_activities(local_date);

-- Recommendations are computed on the fly from records (never stored as facts); only dismissals persist.
CREATE TABLE recommendation_dismissals (
  rule_id TEXT NOT NULL,
  dismissed_on TEXT NOT NULL,
  PRIMARY KEY (rule_id, dismissed_on)
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Public share links created through the optional cloud service.
CREATE TABLE share_links (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('run','swim','workout')),
  entity_id TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
`,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** Applies pending migrations, each inside its own transaction. Idempotent. */
export async function migrate(db: Db): Promise<number[]> {
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);');
  const done = new Set((await db.all<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, new Date().toISOString()]);
    });
    applied.push(m.version);
  }
  await seedCatalog(db);
  return applied;
}

/** Exercise catalog rows. Idempotent (INSERT OR IGNORE / upsert of config). */
async function seedCatalog(db: Db): Promise<void> {
  const extra: { id: string; name: string; category: string }[] = [
    { id: 'lunge', name: 'Lunge', category: 'legs' },
    { id: 'plank', name: 'Plank', category: 'core' },
    { id: 'pike_pushup', name: 'Pike push-up', category: 'push' },
    { id: 'pullup', name: 'Pull-up', category: 'pull' },
    { id: 'burpee', name: 'Burpee', category: 'full body' },
  ];
  await db.transaction(async (tx) => {
    for (const ex of Object.values(EXERCISES)) {
      await tx.run('INSERT OR IGNORE INTO exercises (id, name, category, camera_supported) VALUES (?, ?, ?, 1)', [ex.id, ex.name, ex.id === 'pushup' ? 'push' : 'legs']);
      await tx.run('INSERT OR REPLACE INTO exercise_analysis_configs (exercise_id, version, config_json) VALUES (?, ?, ?)', [ex.id, ex.config.version, JSON.stringify(ex.config)]);
    }
    for (const e of extra) {
      await tx.run('INSERT OR IGNORE INTO exercises (id, name, category, camera_supported) VALUES (?, ?, ?, 0)', [e.id, e.name, e.category]);
    }
    await tx.run("INSERT OR IGNORE INTO exercise_variations (id, exercise_id, name) VALUES ('pushup_knee', 'pushup', 'Knee push-up'), ('pushup_incline', 'pushup', 'Incline push-up')");
  });
}
