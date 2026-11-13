# ExoSignal

An interactive readout for a saved exoplanet discovery-method classifier. The app
loads `exoplanet_model.pkl` once at startup and serves a small, dependency-light
web interface around it — no retraining, no gradients.

## What it does

- Takes orbital, stellar, and sky-position values plus optional survey metadata.
- Passes unsupplied fields to the model as `NaN`, which is how the
  `HistGradientBoostingClassifier` was trained to handle missing measurements.
- Returns probabilities for **Transit**, **Radial Velocity**, and **Other**.
- Shows a live confidence ring, class distribution, and a one-variable-at-a-time
  sensitivity chart.

## Dataset

The model's 30 input features come from the **Kepler Confirmed Planets** dataset:

- Kaggle: <https://www.kaggle.com/datasets/melissamonfared/kepler-confirmed-planets>

It provides the orbital, stellar, and sky-position measurements — plus the
survey and uncertainty flags — used to train the saved classifier.

## Requirements

- Python 3.10+

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python server.py
```

Open <http://127.0.0.1:5000>.

## Project layout

```
exoplanet_model.pkl    Joblib bundle: model, scaler, columns, classes
server.py              Flask app and JSON endpoints
templates/index.html   Page markup
static/css/styles.css  Layout, themes, and motion
static/js/app.js       Field logic, presets, prediction, chart
static/fonts/          Locally bundled Inter, Fraunces, JetBrains Mono
```

## API

| Endpoint       | Method | Purpose                                  |
| -------------- | ------ | ---------------------------------------- |
| `/api/meta`    | GET    | Model metadata, fields, presets, classes |
| `/api/predict` | POST   | `{ "features": { ... } }` → probabilities |
| `/api/sweep`   | POST   | Probability curve for one varied feature  |
| `/health`      | GET    | Liveness check                           |

Example:

```bash
curl -s http://127.0.0.1:5000/api/predict \
  -H 'Content-Type: application/json' \
  -d '{"features":{"pl_orbper":300,"pl_radj":1.0,"st_teff":5700,"st_mass":1.0,"st_rad":1.0,"st_optmag":8.0}}'
```

## Notes

- The classifier reproduces patterns and biases in the Kepler Confirmed Planets
  dataset (NASA Exoplanet Archive), not new discoveries.
- Feature importance in the UI is the share of tree splits per feature — a
  structural proxy, not a causal ranking.
- The theme preference is stored in `localStorage`.
