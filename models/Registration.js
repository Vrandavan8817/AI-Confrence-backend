import mongoose from "mongoose";

const RegistrationSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  gender: { type: String, required: true },
  dob: { type: String, required: true },
  nationality: { type: String, required: true },
  mobile: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  address: { type: String, required: true },
  institution: { type: String, required: true },
  designation: { type: String, required: true },
  department: { type: String, required: true },
  category: { type: String, required: true },
  fee: { type: Number, required: true },
  paymentRef: { type: String, required: true },
  participation: { type: String, required: true },
  submissionTitle: { type: String, required: true },
  authors: { type: String, required: true },
  abstractText: { type: String, required: true },
  declaration: { type: Boolean, default: false },
  
  // File fields (added)
  receiptFileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  receiptFileName: { type: String, required: true },
  abstractFileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  abstractFileName: { type: String, required: true },
  
  // Timestamps (added)
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Pre-save hook to update updatedAt
RegistrationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("Registration", RegistrationSchema);