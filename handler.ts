import { APIGatewayProxyHandler } from "aws-lambda";
import { S3, config, DynamoDB } from "aws-sdk";
import "source-map-support/register";

config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY
});

export const hello: APIGatewayProxyHandler = async (_event, _context) => {
  const s3 = new S3();
  const dynamodb = new DynamoDB();
  const s3Data = await s3
    .listObjectsV2({ Bucket: "vpc-demo-bucket" })
    .promise();
  const { Items: dynamoData } = await dynamodb
    .scan({ TableName: "vpc-demo-table" })
    .promise();

  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        s3Data,
        dynamoData
      },
      null,
      2
    )
  };
};
