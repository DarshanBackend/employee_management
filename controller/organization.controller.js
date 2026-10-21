import mongoose from "mongoose";
import OrganizationModel from "../model/organization.model.js";
import BranchModel from "../model/branch.model.js";
import UserModel from "../model/user.model.js";
import { recordAuditLog } from "../utils/auditLogger.js";
import {
  sendCreatedResponse,
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";

export class OrganizationController {
  static async getOrganizationSettings(req, res) {
    try {
      let organization = await OrganizationModel.findOne().lean();
      if (!organization) {
        organization = await OrganizationModel.create({
          companyLegalName: "Digital HRS Infotech Private Limited",
          registrationNumber: "U72900MU2024PTC345678",
          gstin: "27AABCT1234F1Z5",
          officialEmail: "hr@digitalhrsinfotech.com",
          companyWebsite: "https://digitalhrsinfotech.com",
        });
        organization = organization.toObject();
      }

      const rawBranches = await BranchModel.find({ isDeleted: false })
        .sort({ isHeadquarters: -1, createdAt: 1 })
        .lean();

      const branches = await Promise.all(
        rawBranches.map(async (branch) => {
          const assignedCount = await UserModel.countDocuments({
            $or: [
              { workLocation: { $regex: new RegExp(`^${branch.branchName}$`, "i") } },
              { workLocation: { $regex: new RegExp(branch.branchName.split(" ")[0], "i") } },
            ],
            isUserDeleted: { $ne: true },
          });

          return {
            ...branch,
            coordinates: `${branch.latitude}, ${branch.longitude}`,
            geofenceRadiusText: `${branch.geofenceRadius} Meters`,
            assignedTeamCount: assignedCount,
            assignedTeamText: `${assignedCount} Employee${assignedCount === 1 ? "" : "s"}`,
          };
        })
      );

      return sendSuccessResponse(res, "Organization & Branch settings fetched successfully", {
        companyInformation: {
          _id: organization._id,
          companyLegalName: organization.companyLegalName,
          registrationNumber: organization.registrationNumber,
          gstin: organization.gstin,
          officialEmail: organization.officialEmail,
          companyWebsite: organization.companyWebsite,
          updatedAt: organization.updatedAt,
        },
        workLocations: {
          totalLocations: branches.length,
          locationsSubtitle: `${branches.length} office location${branches.length === 1 ? "" : "s"} with active GPS boundaries`,
          branches,
        },
      });
    } catch (error) {
      console.error("Get Organization Settings Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch organization settings", error);
    }
  }

  static async getOrganizationInfo(req, res) {
    try {
      let organization = await OrganizationModel.findOne().lean();
      if (!organization) {
        organization = await OrganizationModel.create({
          companyLegalName: "Digital HRS Infotech Private Limited",
          registrationNumber: "U72900MU2024PTC345678",
          gstin: "27AABCT1234F1Z5",
          officialEmail: "hr@digitalhrsinfotech.com",
          companyWebsite: "https://digitalhrsinfotech.com",
        });
        organization = organization.toObject();
      }

      return sendSuccessResponse(res, "Company information fetched successfully", organization);
    } catch (error) {
      console.error("Get Organization Info Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch company information", error);
    }
  }

  static async updateOrganizationInfo(req, res) {
    try {
      const {
        companyLegalName,
        companyName,
        registrationNumber,
        cin,
        llpin,
        gstin,
        taxId,
        officialEmail,
        email,
        companyWebsite,
        website,
      } = req.body;

      const legalName = (companyLegalName || companyName || "").trim();
      const regNo = (registrationNumber || cin || llpin || "").trim();
      const gst = (gstin || taxId || "").trim();
      const mail = (officialEmail || email || "").trim();
      const site = (companyWebsite || website || "").trim();

      let organization = await OrganizationModel.findOne();

      if (!organization) {
        organization = new OrganizationModel({
          companyLegalName: legalName || "Company Name",
          registrationNumber: regNo,
          gstin: gst,
          officialEmail: mail,
          companyWebsite: site,
          updatedBy: req.user?._id || null,
        });
      } else {
        if (legalName) organization.companyLegalName = legalName;
        if (registrationNumber !== undefined || cin !== undefined || llpin !== undefined) {
          organization.registrationNumber = regNo;
        }
        if (gstin !== undefined || taxId !== undefined) {
          organization.gstin = gst;
        }
        if (officialEmail !== undefined || email !== undefined) {
          organization.officialEmail = mail;
        }
        if (companyWebsite !== undefined || website !== undefined) {
          organization.companyWebsite = site;
        }
        organization.updatedBy = req.user?._id || null;
      }

      await organization.save();

      await recordAuditLog(req, {
        action: "Updated Company Profile",
        category: "Security",
        description: `Updated company details for '${organization.companyLegalName}'`,
        targetResource: organization.companyLegalName,
        diff: {
          before: "Previous Organization Profile",
          after: `Organization: ${organization.companyLegalName}`,
        },
      });

      return sendSuccessResponse(res, "Company Information saved successfully!", organization);
    } catch (error) {
      console.error("Update Organization Info Error:", error);
      return sendErrorResponse(res, 500, "Failed to save company information", error);
    }
  }

  static async addBranch(req, res) {
    try {
      const {
        branchName,
        name,
        isHeadquarters = false,
        isHQ,
        branchType,
        address,
        physicalAddress,
        latitude,
        longitude,
        coordinates,
        geofenceRadius = 150,
        radius,
        status = "Active",
      } = req.body;

      const finalName = (branchName || name || "").trim();
      if (!finalName) {
        return sendBadRequestResponse(res, "Branch Name is required!");
      }

      const finalAddress = (physicalAddress || address || "").trim();
      if (!finalAddress) {
        return sendBadRequestResponse(res, "Physical Address is required!");
      }

      let lat = 0;
      let lng = 0;

      if (latitude !== undefined && !isNaN(Number(latitude))) {
        lat = Number(latitude);
      }
      if (longitude !== undefined && !isNaN(Number(longitude))) {
        lng = Number(longitude);
      }

      if (coordinates && typeof coordinates === "string") {
        const parts = coordinates.split(",").map((p) => parseFloat(p.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          lat = parts[0];
          lng = parts[1];
        }
      }

      const finalRadius = Number(geofenceRadius || radius || 150);
      const isHqBool = Boolean(isHeadquarters || isHQ || branchType === "HQ" || branchType === "Headquarters");

      const existing = await BranchModel.findOne({
        branchName: { $regex: new RegExp(`^${finalName}$`, "i") },
        isDeleted: false,
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Branch with name '${finalName}' already exists.`,
        });
      }

      if (isHqBool) {
        await BranchModel.updateMany({ isHeadquarters: true }, { $set: { isHeadquarters: false } });
      }

      const newBranch = await BranchModel.create({
        branchName: finalName,
        isHeadquarters: isHqBool,
        address: finalAddress,
        latitude: Number(lat),
        longitude: Number(lng),
        geofenceRadius: finalRadius,
        status: status === "Inactive" ? "Inactive" : "Active",
        isActive: status !== "Inactive",
        createdBy: req.user?._id || null,
      });

      await recordAuditLog(req, {
        action: "Added New Branch",
        category: "Security",
        description: `Added new branch '${newBranch.branchName}' with ${newBranch.geofenceRadius}m geofence radius`,
        targetResource: newBranch.branchName,
        diff: {
          before: "None",
          after: `Branch: ${newBranch.branchName} (Radius: ${newBranch.geofenceRadius}m)`,
        },
      });

      return sendCreatedResponse(res, "Branch added successfully!", {
        ...newBranch.toObject(),
        coordinates: `${newBranch.latitude}, ${newBranch.longitude}`,
        geofenceRadiusText: `${newBranch.geofenceRadius} Meters`,
        assignedTeamCount: 0,
        assignedTeamText: "0 Employees",
      });
    } catch (error) {
      console.error("Add Branch Error:", error);
      return sendErrorResponse(res, 500, "Failed to add branch", error);
    }
  }

  static async getAllBranches(req, res) {
    try {
      const rawBranches = await BranchModel.find({ isDeleted: false })
        .sort({ isHeadquarters: -1, createdAt: 1 })
        .lean();

      const branches = await Promise.all(
        rawBranches.map(async (branch) => {
          const assignedCount = await UserModel.countDocuments({
            $or: [
              { workLocation: { $regex: new RegExp(`^${branch.branchName}$`, "i") } },
              { workLocation: { $regex: new RegExp(branch.branchName.split(" ")[0], "i") } },
            ],
            isUserDeleted: { $ne: true },
          });

          return {
            ...branch,
            coordinates: `${branch.latitude}, ${branch.longitude}`,
            geofenceRadiusText: `${branch.geofenceRadius} Meters`,
            assignedTeamCount: assignedCount,
            assignedTeamText: `${assignedCount} Employee${assignedCount === 1 ? "" : "s"}`,
          };
        })
      );

      return sendSuccessResponse(res, "Branches fetched successfully", {
        total: branches.length,
        branches,
      });
    } catch (error) {
      console.error("Get All Branches Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch branches", error);
    }
  }

  static async getBranchById(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid branch ID");
      }

      const branch = await BranchModel.findOne({ _id: id, isDeleted: false }).lean();
      if (!branch) {
        return sendNotFoundResponse(res, "Branch not found");
      }

      const assignedCount = await UserModel.countDocuments({
        $or: [
          { workLocation: { $regex: new RegExp(`^${branch.branchName}$`, "i") } },
          { workLocation: { $regex: new RegExp(branch.branchName.split(" ")[0], "i") } },
        ],
        isUserDeleted: { $ne: true },
      });

      return sendSuccessResponse(res, "Branch details fetched successfully", {
        ...branch,
        coordinates: `${branch.latitude}, ${branch.longitude}`,
        geofenceRadiusText: `${branch.geofenceRadius} Meters`,
        assignedTeamCount: assignedCount,
        assignedTeamText: `${assignedCount} Employee${assignedCount === 1 ? "" : "s"}`,
      });
    } catch (error) {
      console.error("Get Branch By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch branch details", error);
    }
  }

  static async updateBranch(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid branch ID");
      }

      const branch = await BranchModel.findOne({ _id: id, isDeleted: false });
      if (!branch) {
        return sendNotFoundResponse(res, "Branch not found");
      }

      const {
        branchName,
        name,
        isHeadquarters,
        isHQ,
        branchType,
        address,
        physicalAddress,
        latitude,
        longitude,
        coordinates,
        geofenceRadius,
        radius,
        status,
        isActive,
      } = req.body;

      const newName = (branchName || name || "").trim();
      if (newName && newName.toLowerCase() !== branch.branchName.toLowerCase()) {
        const duplicate = await BranchModel.findOne({
          _id: { $ne: branch._id },
          branchName: { $regex: new RegExp(`^${newName}$`, "i") },
          isDeleted: false,
        });
        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: `Another branch with name '${newName}' already exists.`,
          });
        }
        branch.branchName = newName;
      }

      if (physicalAddress !== undefined || address !== undefined) {
        branch.address = (physicalAddress || address || "").trim();
      }

      if (latitude !== undefined && !isNaN(Number(latitude))) {
        branch.latitude = Number(latitude);
      }
      if (longitude !== undefined && !isNaN(Number(longitude))) {
        branch.longitude = Number(longitude);
      }

      if (coordinates && typeof coordinates === "string") {
        const parts = coordinates.split(",").map((p) => parseFloat(p.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          branch.latitude = parts[0];
          branch.longitude = parts[1];
        }
      }

      const oldRadius = branch.geofenceRadius;
      if (geofenceRadius !== undefined || radius !== undefined) {
        const rad = Number(geofenceRadius || radius);
        if (!isNaN(rad) && rad >= 10) {
          branch.geofenceRadius = rad;
        }
      }

      if (isHeadquarters !== undefined || isHQ !== undefined) {
        const isHqBool = Boolean(isHeadquarters !== undefined ? isHeadquarters : isHQ);
        if (isHqBool && !branch.isHeadquarters) {
          await BranchModel.updateMany(
            { _id: { $ne: branch._id }, isHeadquarters: true },
            { $set: { isHeadquarters: false } }
          );
        }
        branch.isHeadquarters = isHqBool;
      }

      if (status !== undefined) {
        branch.status = String(status).toLowerCase() === "inactive" ? "Inactive" : "Active";
        branch.isActive = branch.status === "Active";
      } else if (isActive !== undefined) {
        branch.isActive = Boolean(isActive);
        branch.status = branch.isActive ? "Active" : "Inactive";
      }

      branch.updatedBy = req.user?._id || null;
      await branch.save();

      const isGeofenceChanged = oldRadius !== branch.geofenceRadius;
      await recordAuditLog(req, {
        action: isGeofenceChanged ? "Geofence Boundary Modified" : "Updated Branch Details",
        category: "Security",
        description: isGeofenceChanged
          ? `Updated ${branch.branchName} check-in perimeter radius to ${branch.geofenceRadius}m`
          : `Updated location & configuration for branch '${branch.branchName}'`,
        targetResource: branch.branchName,
        diff: {
          before: isGeofenceChanged
            ? `Geofence Radius: ${oldRadius}m (${branch.branchName})`
            : `Branch: ${branch.branchName}`,
          after: isGeofenceChanged
            ? `Geofence Radius: ${branch.geofenceRadius}m (${branch.branchName})`
            : `Branch: ${branch.branchName}`,
        },
      });

      return sendSuccessResponse(res, "Branch updated successfully!", {
        ...branch.toObject(),
        coordinates: `${branch.latitude}, ${branch.longitude}`,
        geofenceRadiusText: `${branch.geofenceRadius} Meters`,
      });
    } catch (error) {
      console.error("Update Branch Error:", error);
      return sendErrorResponse(res, 500, "Failed to update branch", error);
    }
  }

  static async deleteBranch(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid branch ID");
      }

      const branch = await BranchModel.findOne({ _id: id, isDeleted: false });
      if (!branch) {
        return sendNotFoundResponse(res, "Branch not found");
      }

      branch.isDeleted = true;
      branch.updatedBy = req.user?._id || null;
      await branch.save();

      await recordAuditLog(req, {
        action: "Deleted Branch",
        category: "Security",
        description: `Deleted branch location '${branch.branchName}'`,
        targetResource: branch.branchName,
        diff: {
          before: `Branch: ${branch.branchName} (Radius: ${branch.geofenceRadius}m)`,
          after: "Branch Deleted",
        },
      });

      return sendSuccessResponse(res, `Branch '${branch.branchName}' deleted successfully.`);
    } catch (error) {
      console.error("Delete Branch Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete branch", error);
    }
  }
}
