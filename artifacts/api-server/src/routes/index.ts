import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import ocrRouter from "./ocr";
import extractRouter from "./extract";
import profilesRouter from "./profiles";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(ocrRouter);
router.use(extractRouter);
router.use(profilesRouter);

export default router;
