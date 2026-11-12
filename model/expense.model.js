import mongoose from "mongoose";

const ExpenseSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Employee reference is required"],
      index: true,
    },
    title: {
      type: String,
      required: [true, "Expense title is required"],
      trim: true,
    },
    category: {
      type: String,
      default: "Other",
      trim: true,
    },
    amount: {
      type: Number,
      required: [true, "Expense amount is required"],
      min: [0, "Amount must be positive"],
    },
    currency: {
      type: String,
      default: "INR",
      trim: true,
    },
    date: {
      type: String,
      required: [true, "Expense date is required (YYYY-MM-DD)"],
      trim: true,
    },
    formattedDate: {
      type: String,
      trim: true,
    },
    reason: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Cancelled"],
      default: "Pending",
      index: true,
    },
    adminRemarks: {
      type: String,
      default: "",
      trim: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
  }
);

ExpenseSchema.index({ employee: 1, status: 1 });

const ExpenseModel = mongoose.model("Expense", ExpenseSchema);
export default ExpenseModel;

