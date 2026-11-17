import {
  saveBusiness,
  getBusiness
} from "../services/business.service.js";

export async function saveBusinessController(
  req: any,
  res: any
) {
  try {
    const business =
      await saveBusiness(
        req.user.userId,
        req.body
      );

    return res.json({
      business,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        "Failed to save business"
    });
  }
}

export async function getBusinessController(
  req: any,
  res: any
) {
  try {
    const business =
      await getBusiness(
        req.user.userId
      );

    return res.json({
      business,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        "Failed to fetch business"
    });
  }
}