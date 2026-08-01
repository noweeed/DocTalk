const express = require("express");
const auth = require("../middleware/auth.middleware");
const { getPlan, upgrade, portal } = require("../controllers/billing.controller");

const router = express.Router();

router.get("/plan", auth, getPlan);
router.post("/upgrade", auth, upgrade);
router.post("/portal", auth, portal);

module.exports = router;
