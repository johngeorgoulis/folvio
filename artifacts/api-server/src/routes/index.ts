import { Router, type IRouter } from "express";
import healthRouter from "./health";
import yahooRouter from "./yahoo";
import etfdataRouter from "./etfdata";

const router: IRouter = Router();

router.use(healthRouter);
router.use(yahooRouter);
router.use(etfdataRouter);

export default router;
