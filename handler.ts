import { APIGatewayProxyHandler } from "aws-lambda";
import { S3, DynamoDB } from "aws-sdk";
import "source-map-support/register";

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
