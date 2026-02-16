// ===========================================================================
// Centralized Monday.com Board Configuration
// ===========================================================================
// All board IDs, column IDs, group IDs, and user IDs in one place.
// Both the follow-up bot and newsletter bot should import from this file
// to prevent breakage when Monday.com columns change.
//
// Last updated: 2026-02-15 (board audit)
// ===========================================================================

module.exports = {

  // ── Workspace ──────────────────────────────────────────────────────────
  workspace: {
    capitalRaising: { id: 14261694, name: 'Capital Raising Management' },
    eliteInvestors: { id: 13949348, name: 'Elite Investors' },
  },

  // ── Board 1: Relationship Management ──────────────────────────────────
  // The follow-up bot WRITES follow-up activity here.
  relationshipManagement: {
    boardId: 18399401453,
    boardUrl: 'https://elitecapitalgroup.monday.com/boards/18399401453/pulses/',
    columns: {
      name:               'name',
      person:             'person',
      status:             'status',
      date:               'date4',
      investorStatus:     'color_mm0mbm8z',
      followUpCadence:    'color_mm0m5rtx',
      lastContactDate:    'date_mm0m92td',
      nextFollowUp:       'date_mm0mme0w',
      communicationMethod:'color_mm0m1ysc',
      email:              'email_mm0mjwa8',
      phone:              'phone_mm0m8ye5',
      notes:              'long_text_mm0mrnn5',
      linkedInvestor:     'board_relation_mm0myg9c',
    },
    groups: {
      activeFollowUps:    'topics',
      completedFollowUps: 'group_title',
    },
    // Status label options for investorStatus column
    investorStatusLabels: {
      hotLead:     '🔥 Hot Lead',
      warmProspect:'🟡 Warm Prospect',
      coldNew:     '🔵 Cold / New',
      committed:   '✅ Committed',
      funded:      '💰 Funded',
      passed:      '❌ Passed',
    },
    // Status label options for followUpCadence column
    cadenceLabels: {
      every1to3:   'Every 1-3 Days',
      every5to7:   'Every 5-7 Days',
      every14:     'Every 14 Days',
      monthly:     'Monthly',
    },
    // Status label options for communicationMethod column
    commMethodLabels: {
      email:      'Email',
      phone:      'Phone',
      text:       'Text',
      linkedin:   'LinkedIn',
      inPerson:   'In-Person',
    },
  },

  // ── Board 2: Investor List ────────────────────────────────────────────
  // The follow-up bot READS investor data from here.
  investorList: {
    boardId: 18399326252,
    boardUrl: 'https://elitecapitalgroup.monday.com/boards/18399326252/pulses/',
    columns: {
      name:              'name',
      status:            'color_mm0d1f8z',
      email:             'email_mm0dh83c',
      phone:             'phone_mm0dymr8',
      company:           'text_mm0da4z4',
      source:            'dropdown_mm0dxpzg',
      investorType:      'dropdown_mm0dtj0p',
      referredBy:        'text_mm0db450',
      investmentInterest:'numeric_mm0dx8ez',
      dealInterest:      'dropdown_mm0dvrsf',
      assignedTo:        'multiple_person_mm0dq26t',
      lastContactDate:   'date_mm0dm8y0',
      nextFollowUp:      'date_mm0drsbg',
      notes:             'long_text_mm0dvjg7',
    },
    groups: {
      hotLeads:      'group_mm0dyh04',
      warmProspects: 'group_mm0d4mqk',
      coldNewLeads:  'group_mm0ddbx',
      committed:     'group_mm0d4m6g',
      funded:        'group_mm0d45zg',
      passed:        'group_mm0d7bte',
    },
    // Status IDs for the investor status column
    statusIds: {
      funded:   1,
      hotLead:  5,
      committed:6,
      coldNew:  7,
      warm:     9,
      passed:   17,
    },
  },

  // ── Board 3: Monthly Email Newsletter ─────────────────────────────────
  // The newsletter bot reads from and updates here.
  newsletter: {
    boardId: 18399401340,
    columns: {
      name:              'name',
      person:            'person',
      status:            'status',
      date:              'date4',
      topic:             'text_mm0e181z',
      contentType:       'dropdown_mm0ear1',
      targetAudience:    'dropdown_mm0ect5w',
      educationalValue:  'long_text_mm0ey81q',
      dealUpdates:       'long_text_mm0ec6g7',
      sendDate:          'date_mm0ehyj9',
      newsletterStatus:  'color_mm0e8tj0',
      resourcesLinks:    'link_mm0ew6ef',
      openRate:          'numeric_mm0eywb2',
      clickRate:         'numeric_mm0ek1tz',
      linkedDeals:       'board_relation_mm0etfyh',
      distributionMode:  'color_mm0ehbdh',
      marketInsights:    'long_text_mm0fjeej',
      investorResources: 'long_text_mm0fvnhc',
      personalMessage:   'long_text_mm0f45kf',
    },
    groups: {
      contentIdeas:   'group_mm0e11kn',
      sentNewsletters:'group_mm0e5xcy',
      upcoming:       'group_mm0eamsg',
    },
    // Newsletter Status label IDs
    statusIds: {
      planning:  0,
      drafting:  1,
      review:    2,
      scheduled: 3,
      sent:      4,
    },
    statusLabels: {
      planning:  'Planning',
      drafting:  'Drafting',
      review:    'Review',
      scheduled: 'Scheduled',
      sent:      'Sent',
    },
    // Distribution Mode label IDs
    distributionIds: {
      testMode: 9,
      live:     1,
      paused:   2,
    },
    distributionLabels: {
      testMode: 'TEST MODE',
      live:     'LIVE',
      paused:   'PAUSED',
    },
  },

  // ── Board 4: Investor Communications Log ──────────────────────────────
  // Both bots LOG investor communications here.
  communicationsLog: {
    boardId: 18399326425,
    columns: {
      name:              'name',
      communicationType: 'color_mm0dm156',
      dealSPV:           'text_mm0dv1rk',
      dateSent:          'date_mm0dmpph',
      sendStatus:        'color_mm0dvx47',
      sentBy:            'multiple_person_mm0dp5dx',
      attachments:       'file_mm0dc1n2',
      notes:             'long_text_mm0dfe63',
    },
    groups: {
      quarterlyUpdates:      'group_mm0dhbjq',
      distributionNotices:   'group_mm0djzr6',
      capitalCalls:          'group_mm0d4csz',
      k1sTaxDocs:            'group_mm0dm6m0',
      adHocCommunications:   'topics',
    },
    // Communication Type label IDs
    commTypeIds: {
      capitalCall:     0,
      distributionNotice: 1,
      k1Tax:           4,
      quarterlyUpdate: 7,
      adHocOther:      17,
    },
    commTypeLabels: {
      capitalCall:     'Capital Call',
      distributionNotice: 'Distribution Notice',
      k1Tax:           'K-1/Tax',
      quarterlyUpdate: 'Quarterly Update',
      adHocOther:      'Ad Hoc / Other',
    },
    // Send Status label IDs
    sendStatusIds: {
      drafting:     9,
      readyToSend:  7,
      sent:         1,
    },
    sendStatusLabels: {
      drafting:     'Drafting',
      readyToSend:  'Ready to Send',
      sent:         'Sent',
    },
  },

  // ── Board 5: Investor File Tracker ────────────────────────────────────
  investorFileTracker: {
    boardId: 18399207642,
    columns: {
      name:          'name',
      files:         'file_mm0dgt21',
      investorName:  'text_mm0dg12k',
      documentType:  'color_mm0dp89b',
      amount:        'numeric_mm0d3hbm',
      expirationDate:'date_mm0dt286',
      notes:         'long_text_mm0dcrk6',
      documentCategory:'color_mm0g4n5x',
      fileDate:      'date_mm0ghfjv',
      expiryDate:    'date_mm0gke32',
      uploadedBy:    'text_mm0gmh0r',
      confidence:    'numeric_mm0gqk8t',
      file:          'file_mm0gt2g4',
      slackLink:     'link_mm0gh9vr',
      assignedTo:    'multiple_person_mm0gs6p3',
    },
    groups: {
      unknownInvestor:    'group_mm0da68v',
      pendingDocuments:   'topics',
      completedDocuments: 'group_title',
    },
  },

  // ── Board 6: Active Offerings ─────────────────────────────────────────
  activeOfferings: {
    boardId: 18399326336,
  },

  // ── Team User IDs ─────────────────────────────────────────────────────
  team: {
    anton:      { mondayUserId: 98265513, email: 'anton@elitecapitalgroup.co' },
    alejandro:  { mondayUserId: 67053759, email: 'alejandro@elitecapitalgroup.co' },
    casey:      { mondayUserId: 98514143, email: 'casey@elitecapitalgroup.co' },
  },
};
