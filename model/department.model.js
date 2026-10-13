import mongoose from "mongoose";

const DepartmentSchema = new mongoose.Schema(
  {
    departmentName: {
      type: String,
      required: [true, "Department name is required"],
      trim: true,
    },
    icon: {
      type: String,
      required: [
        function () {
          return !this.isDeleted;
        },
        "Department icon/image is required",
      ],
      default: null,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    departmentHead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    color: {
      type: String,
      required: [true, "Department color is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

DepartmentSchema.index({ departmentName: 1, isDeleted: 1 });

const DepartmentModel = mongoose.model("Department", DepartmentSchema);
export default DepartmentModel;
