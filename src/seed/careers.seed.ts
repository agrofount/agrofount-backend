import { DataSource } from 'typeorm';
import { pgConfig } from '../config/database/database.config';
import {
  CareerEmploymentType,
  CareerJobEntity,
  CareerJobStatus,
  CareerWorkMode,
} from '../careers/entities/career-job.entity';
import { JobApplicationEntity } from '../careers/entities/job-application.entity';

type SeedCareerPosition = {
  slug: string;
  title: string;
  department: string;
  location: string;
  type: string;
  mode: string;
  salary?: string;
  closingDate?: string;
  description: string;
  isOpen: boolean;
  responsibilities?: string[];
  requirements?: string[];
  benefits?: string[];
};

const careerPositions: SeedCareerPosition[] = [
  {
    slug: 'sales-representative-poultry',
    title: 'Senior Sales Representative (Poultry)',
    department: 'Sales',
    location: 'Lagos, Nigeria / Remote',
    type: 'Full-time',
    mode: 'Remote',
    salary: '₦250,000 - ₦400,000',
    closingDate: '30 June 2026',
    description:
      'We are looking for a results-driven Senior Sales Representative (Poultry) to join our team. You will be responsible for expanding our customer base, driving sales growth, and building strong relationships with poultry farmers across Nigeria.',
    isOpen: true,
    responsibilities: [
      'Generate and pursue poultry sales opportunities',
      'Build and maintain strong relationships with farmers',
      'Meet and exceed monthly sales targets',
      'Conduct field visits and market assessments',
      'Register and onboard new farmers on Agrofount platform',
    ],
    requirements: [
      'Minimum OND/HND/BSc in any field',
      '2+ years of sales experience, preferably in poultry or agribusiness',
      'Strong communication and negotiation skills',
      'Proficient in using mobile apps and CRM tools',
      'Ability to travel across states',
    ],
    benefits: [
      'Competitive salary and performance bonuses',
      'Career growth and advancement opportunities',
      'Continuous training and development',
      'Health insurance',
      'Flexible and supportive work environment',
      'Opportunity to impact thousands of farmers',
    ],
  },
  {
    slug: 'customer-support-officer',
    title: 'Customer Support Officer',
    department: 'Customer Success',
    location: 'Remote',
    type: 'Full-time',
    mode: 'Remote',
    description:
      'Handle farmer inquiries and provide excellent customer support.',
    isOpen: false,
    responsibilities: [
      'Resolve customer queries with empathy and speed.',
      'Log support tickets and follow up on outstanding issues.',
      'Provide guidance on product use and best practices.',
    ],
  },
  {
    slug: 'logistics-coordinator',
    title: 'Logistics Coordinator',
    department: 'Logistics',
    location: 'Lagos',
    type: 'Full-time',
    mode: 'On-site',
    description:
      'Manage deliveries, routes, and ensure timely order fulfillment.',
    isOpen: false,
    responsibilities: [
      'Coordinate delivery schedules and route planning.',
      'Monitor shipments and resolve logistical issues.',
      'Collaborate with suppliers and operations teams.',
    ],
  },
  {
    slug: 'farm-advisor',
    title: 'Farm Advisor',
    department: 'Advisory',
    location: 'Ogun, Osun, Kwara',
    type: 'Full-time',
    mode: 'Field',
    description:
      'Advise farmers on best practices and product recommendations.',
    isOpen: false,
    responsibilities: [
      'Visit farms and provide agronomy support.',
      'Recommend products and inputs based on soil needs.',
      'Collect feedback to improve farmer outcomes.',
    ],
  },
  {
    slug: 'procurement-officer',
    title: 'Procurement Officer',
    department: 'Operations',
    location: 'Lagos',
    type: 'Full-time',
    mode: 'On-site',
    description: 'Source quality products and manage supplier relationships.',
    isOpen: false,
    responsibilities: [
      'Manage supplier sourcing and vendor agreements.',
      'Ensure timely procurement of inventory and goods.',
      'Track procurement costs and maintain supplier quality.',
    ],
  },
  {
    slug: 'operations-associate',
    title: 'Operations Associate',
    department: 'Operations',
    location: 'Lagos',
    type: 'Full-time',
    mode: 'On-site',
    description:
      'Support daily operations and ensure smooth business workflow.',
    isOpen: false,
    responsibilities: [
      'Support operational processes across the team.',
      'Help coordinate cross-functional workstreams.',
      'Track performance and assist with process improvements.',
    ],
  },
  {
    slug: 'digital-marketing-specialist',
    title: 'Digital Marketing Specialist',
    department: 'Marketing',
    location: 'Remote',
    type: 'Full-time',
    mode: 'Remote',
    description: 'Create campaigns that grow brand awareness and engagement.',
    isOpen: false,
    responsibilities: [
      'Design digital campaigns for farmers and suppliers.',
      'Analyze campaign performance and optimize spend.',
      'Collaborate with product and design teams.',
    ],
  },
  {
    slug: 'senior-software-engineer',
    title: 'Senior Software Engineer',
    department: 'Engineering',
    location: 'Remote',
    type: 'Full-time',
    mode: 'Remote',
    description: 'Build and scale platforms that empower farmers.',
    isOpen: false,
    responsibilities: [
      'Develop and ship reliable software solutions.',
      'Collaborate with product teams to define requirements.',
      'Mentor engineers and drive engineering best practices.',
    ],
  },
  {
    slug: 'quality-assurance-analyst',
    title: 'Quality Assurance Analyst',
    department: 'Quality',
    location: 'Lagos',
    type: 'Full-time',
    mode: 'Hybrid',
    description: 'Inspect marketplace listings and improve quality controls.',
    isOpen: false,
    responsibilities: [
      'Review product listings for quality and compliance.',
      'Report issues and recommend quality improvements.',
      'Work with operations to maintain marketplace standards.',
    ],
  },
  {
    slug: 'finance-associate',
    title: 'Finance Associate',
    department: 'Finance',
    location: 'Lagos',
    type: 'Full-time',
    mode: 'Hybrid',
    description:
      'Support credit, wallet, settlement, and marketplace reporting.',
    isOpen: false,
    responsibilities: [
      'Support financial reporting and reconciliations.',
      'Assist with wallet and settlement processes.',
      'Help improve financial controls and accuracy.',
    ],
  },
  {
    slug: 'supplier-success-manager',
    title: 'Supplier Success Manager',
    department: 'Supplier Success',
    location: 'Ibadan',
    type: 'Full-time',
    mode: 'Field',
    description: 'Help verified suppliers grow sales and improve fulfillment.',
    isOpen: false,
    responsibilities: [
      'Support suppliers with onboarding and growth.',
      'Monitor supplier performance and customer success.',
      'Drive supplier adoption of Agrofount tools.',
    ],
  },
  {
    slug: 'content-and-training-lead',
    title: 'Content and Training Lead',
    department: 'Learning',
    location: 'Remote',
    type: 'Full-time',
    mode: 'Remote',
    description: 'Create farmer education content and team learning programs.',
    isOpen: false,
    responsibilities: [
      'Design training content for farmers and staff.',
      'Manage learning programs and knowledge sharing.',
      'Measure impact and improve learning outcomes.',
    ],
  },
];

const employmentTypeMap: Record<string, CareerEmploymentType> = {
  'full-time': CareerEmploymentType.FullTime,
  'part-time': CareerEmploymentType.PartTime,
  contract: CareerEmploymentType.Contract,
  internship: CareerEmploymentType.Internship,
  remote: CareerEmploymentType.Remote,
  hybrid: CareerEmploymentType.Hybrid,
  field: CareerEmploymentType.Field,
};

const workModeMap: Record<string, CareerWorkMode> = {
  remote: CareerWorkMode.Remote,
  'on-site': CareerWorkMode.Onsite,
  onsite: CareerWorkMode.Onsite,
  hybrid: CareerWorkMode.Hybrid,
  field: CareerWorkMode.Field,
};

function parseClosingDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value} 23:59:59 GMT+0100`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requiredFallback(title: string): string[] {
  return [`Relevant experience or strong interest in ${title}.`];
}

async function main() {
  const dataSource = new DataSource({
    ...pgConfig,
    entities: [CareerJobEntity, JobApplicationEntity],
    synchronize: false,
  });
  await dataSource.initialize();

  try {
    const repository = dataSource.getRepository(CareerJobEntity);
    let created = 0;
    let updated = 0;

    for (const position of careerPositions) {
      const existing = await repository.findOne({
        where: { slug: position.slug },
      });
      const payload = {
        slug: position.slug,
        title: position.title,
        department: position.department,
        location: position.location,
        employmentType:
          employmentTypeMap[position.type.toLowerCase()] ||
          CareerEmploymentType.FullTime,
        workMode:
          workModeMap[position.mode.toLowerCase()] || CareerWorkMode.Onsite,
        summary: position.description,
        description: position.description,
        responsibilities: position.responsibilities || [],
        requirements: position.requirements || requiredFallback(position.title),
        benefits: position.benefits || [],
        salaryRange: position.salary || null,
        status: position.isOpen
          ? CareerJobStatus.Published
          : CareerJobStatus.Closed,
        applicationDeadline: parseClosingDate(position.closingDate),
        updatedBy: null,
      };

      await repository.save(
        existing
          ? repository.merge(existing, payload)
          : repository.create({ ...payload, createdBy: null }),
      );
      if (existing) updated += 1;
      else created += 1;
    }

    console.log(
      `Seeded career positions. Created: ${created}. Updated: ${updated}. Total: ${careerPositions.length}.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
